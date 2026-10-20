import { webview } from '@kit.ArkWeb';
import { resourceManager } from '@kit.LocalizationKit';
import { util } from '@kit.ArkTS';
import { rcp } from '@kit.RemoteCommunicationKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { RequestPolicy } from '../security/RequestPolicy';
import { SecureStore } from '../security/SecureStore';

interface Params {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  key?: string;
  value?: string;
}
interface Message { id: string; method: string; params: Params; }
interface NativeResponse { status: number; headers: Record<string, string | string[]>; bodyBase64: string; }
interface SecretResponse { value: string | null; }
interface Reply { id: string; ok: boolean; data?: NativeResponse | SecretResponse | boolean; error?: string; }

/** Only fixed descriptions and numeric system codes may cross into the page. */
class RequestFailure extends Error {
  constructor(description: string, error?: Error) {
    const code = (error as BusinessError | undefined)?.code;
    super(Number.isInteger(code ?? 0) && (code ?? 0) > 0 && (code ?? 0) < 2147483648
      ? `${description}（错误码 ${code}）` : description);
  }
}

export const LOCAL_ORIGIN: string = 'https://ysu.local';

export class NativeBridge {
  private controller: webview.WebviewController;
  private policy?: RequestPolicy;
  private store: SecureStore = new SecureStore();
  private active: Set<string> = new Set();

  constructor(controller: webview.WebviewController) { this.controller = controller; }

  initialize(manager: resourceManager.ResourceManager): void { this.policy = new RequestPolicy(manager); }

  private trusted(): boolean {
    const current = this.controller.getUrl();
    return current.startsWith(`${LOCAL_ORIGIN}/`);
  }

  postMessage(raw: string): void {
    if (raw.length > 524288 || !this.trusted() || !this.policy) return;
    let message: Message;
    try { message = JSON.parse(raw) as Message; } catch { return; }
    if (!/^h[0-9]+$/.test(message.id) || this.active.has(message.id)) return;
    if (this.active.size >= 16) {
      this.reply({ id: message.id, ok: false, error: '请求过于频繁，请稍后重试' });
      return;
    }
    this.active.add(message.id);
    this.dispatch(message).then((reply: Reply) => this.reply(reply)).catch((error: Error) => {
      // Never return raw network errors, URLs, response bodies, cookies or tokens.
      let description = '请求未完成，请重新打开应用后重试';
      if (error instanceof RequestFailure) description = error.message;
      else if (message.method === 'secure.get') description = '安全存储读取失败，请解锁设备后重试';
      else if (message.method === 'secure.set') description = '凭据未能安全保存，请解锁设备后重试';
      else if (message.method === 'secure.remove') description = '安全数据删除失败，请解锁设备后重试';
      this.reply({ id: message.id, ok: false, error: description });
    }).finally(() => { this.active.delete(message.id); });
  }

  private reply(reply: Reply): void {
    if (!this.trusted()) return;
    this.controller.runJavaScript(`window.__ysuHarmonyReply?.(${JSON.stringify(reply)})`).catch(() => {});
  }

  private async dispatch(message: Message): Promise<Reply> {
    const params = message.params;
    if (message.method === 'http.request') {
      return { id: message.id, ok: true, data: await this.request(params) };
    }
    const keys: string[] = ['academic-client-auth', 'academic-client-auth-token',
      'academic-client-remember-me', 'ysu-auth', 'ysu-castgc', 'ysu-remember-me'];
    if (!params.key || !keys.includes(params.key)) throw new Error('Storage key rejected');
    if (message.method === 'secure.get') {
      return { id: message.id, ok: true, data: { value: await this.store.get(params.key) } };
    }
    if (message.method === 'secure.set' && typeof params.value === 'string') {
      await this.store.set(params.key, params.value);
      return { id: message.id, ok: true, data: true };
    }
    if (message.method === 'secure.remove') {
      await this.store.remove(params.key);
      return { id: message.id, ok: true, data: true };
    }
    throw new Error('Unsupported method');
  }

  private async request(params: Params): Promise<NativeResponse> {
    if (!params.url || !params.method || !this.policy) throw new RequestFailure('请求参数无效，请更新应用后重试');
    try { this.policy.validate(params.method, params.url, params.body ?? ''); }
    catch { throw new RequestFailure('学校接口未获准访问，请更新应用后重试'); }
    const allowedHeaders: string[] = ['accept', 'accept-language', 'content-type',
      'cookie', 'user-agent', 'referer', 'origin', 'x-requested-with'];
    const headers: rcp.RequestHeaders = {};
    const sourceHeaders: Record<string, string> = params.headers ?? {};
    Object.keys(sourceHeaders).forEach((key: string) => {
      const value = sourceHeaders[key];
      if (allowedHeaders.includes(key.toLowerCase()) && !/[\r\n]/.test(value)) {
        headers[key.toLowerCase()] = value;
      }
    });
    const timeout = Math.max(1000, Math.min(params.timeoutMs ?? 30000, 60000));
    // Ephemeral sessions: the JS cookie jar is the only source of cookies.
    const configuration: rcp.Configuration = {
      transfer: { autoRedirect: false, timeout: { connectMs: timeout, transferMs: timeout } },
      proxy: 'no-proxy',
      tracing: { verbose: false }
    };
    const options: rcp.SessionConfiguration = { requestConfiguration: configuration };
    let session: rcp.Session;
    try { session = rcp.createSession(options); }
    catch (error) { throw new RequestFailure('学校网络服务初始化失败，请重新打开应用后重试', error as Error); }
    try {
      const request = new rcp.Request(params.url, params.method as rcp.HttpMethod, headers, params.body);
      const response = await session.fetch(request);
      return this.encodeResponse(response);
    } catch (error) {
      if (error instanceof RequestFailure) throw error;
      throw new RequestFailure('学校连接失败，请检查网络后重试', error as Error);
    } finally { session.close(); }
  }

  private encodeResponse(response: rcp.Response): NativeResponse {
    try {
      const bytes = new Uint8Array(response.body ?? new ArrayBuffer(0));
      if (bytes.length > 8 * 1024 * 1024) throw new Error('Response too large');
      const responseHeaders: Record<string, string | string[]> = {};
      Object.keys(response.headers).forEach((key: string) => {
        const value = response.headers[key];
        if (value !== undefined) responseHeaders[key.toLowerCase()] = value;
      });
      return { status: response.statusCode, headers: responseHeaders,
        // Harmony's Base64 API rejects zero-length input with BusinessError 401.
        // Redirects and 204 responses legitimately have no body; preserve their headers.
        bodyBase64: bytes.length === 0 ? '' : new util.Base64Helper().encodeToStringSync(bytes) };
    } catch (error) {
      throw new RequestFailure('学校响应处理失败，请更新应用后重试', error as Error);
    }
  }
}
