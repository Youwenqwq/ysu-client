/**
 * Cookie 管理 + fetch 封装
 *
 * SimpleCookieJar: RFC 6265 domain/path 匹配、过期检查。
 * fetchWithJar: 标准 fetch + jar 读写 + 手动 redirect 跟随。
 */

// ─── CookieEntry ──────────────────────────────────────────────────────── //

export interface CookieEntry {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  /** epoch seconds; null 表示会话级。 */
  readonly expires: number | null;
}

export function cookieEntryFromJSON(d: Record<string, unknown>): CookieEntry {
  const name = d['name'];
  if (typeof name !== 'string') {
    throw new TypeError(`cookie entry missing "name": ${JSON.stringify(d)}`);
  }
  const expiresRaw = d['expires'];
  let expires: number | null = null;
  if (typeof expiresRaw === 'number') {
    expires = Math.trunc(expiresRaw);
  } else if (typeof expiresRaw === 'string' && expiresRaw !== '') {
    const n = Number(expiresRaw);
    if (Number.isFinite(n)) expires = Math.trunc(n);
  }
  return {
    name,
    value: typeof d['value'] === 'string' ? (d['value'] as string) : '',
    domain: typeof d['domain'] === 'string' ? (d['domain'] as string) : '',
    path: typeof d['path'] === 'string' ? (d['path'] as string) : '/',
    secure: Boolean(d['secure']),
    expires,
  };
}

export type CookiePredicate = (entry: CookieEntry) => boolean;

export async function collectCookies(
  jar: SimpleCookieJar,
  predicate: CookiePredicate,
): Promise<CookieEntry[]> {
  const all = await jar.getAllCookies();
  return all.filter((e) => e.value !== '' && predicate(e));
}

export async function installCookies(
  jar: SimpleCookieJar,
  entries: readonly CookieEntry[],
): Promise<void> {
  for (const entry of entries) {
    if (entry.value === '') continue;
    const parts = [`${entry.name}=${entry.value}`];
    if (entry.domain) parts.push(`Domain=${entry.domain}`);
    if (entry.path) parts.push(`Path=${entry.path}`);
    if (entry.secure) parts.push('Secure');
    if (entry.expires !== null) {
      parts.push(`Expires=${new Date(entry.expires * 1000).toUTCString()}`);
    }
    const host = entry.domain.replace(/^\./, '') || 'localhost';
    const url = `https://${host}${entry.path}`;
    await jar.setCookie(parts.join('; '), url, { ignoreError: true });
  }
}

// ─── SimpleCookieJar ──────────────────────────────────────────────────── //

interface SimpleCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  expires: number | null;
}

function parseSetCookie(str: string, url: string): SimpleCookie | null {
  const trimmed = str.trim();
  if (!trimmed) return null;

  const firstSemi = trimmed.indexOf(';');
  const nameValue = firstSemi === -1 ? trimmed : trimmed.slice(0, firstSemi);
  const rest = firstSemi === -1 ? '' : trimmed.slice(firstSemi + 1);

  const eqIdx = nameValue.indexOf('=');
  const name = eqIdx === -1 ? nameValue.trim() : nameValue.slice(0, eqIdx).trim();
  const value = eqIdx === -1 ? '' : nameValue.slice(eqIdx + 1).trim();

  if (!name) return null;

  const parsedUrl = safeParseUrl(url);
  const defaultDomain = parsedUrl?.hostname ?? '';
  const defaultPath = defaultPathFromUrl(parsedUrl?.pathname ?? '/');

  let domain = defaultDomain;
  let path = defaultPath;
  let secure = false;
  let expires: number | null = null;

  const attrs = rest.split(';');
  for (const attr of attrs) {
    const parts = attr.split('=', 2);
    const rawKey = parts[0]!;
    const rawVal = parts[1];
    const key = rawKey.trim().toLowerCase();
    const val = rawVal === undefined ? '' : rawVal.trim();

    switch (key) {
      case 'domain':
        if (val) {
          domain = val.toLowerCase();
          if (!domain.startsWith('.')) {
            domain = '.' + domain;
          }
        }
        break;
      case 'path':
        if (val && val.startsWith('/')) {
          path = val;
        }
        break;
      case 'expires': {
        const d = new Date(val);
        if (!Number.isNaN(d.getTime())) {
          expires = Math.floor(d.getTime() / 1000);
        }
        break;
      }
      case 'max-age': {
        const seconds = Number(val);
        if (Number.isFinite(seconds)) {
          expires = Math.floor(Date.now() / 1000) + seconds;
        }
        break;
      }
      case 'secure':
        secure = true;
        break;
      default:
        break;
    }
  }

  return { name, value, domain, path, secure, expires };
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function defaultPathFromUrl(pathname: string): string {
  const lastSlash = pathname.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return pathname.slice(0, lastSlash);
}

function domainMatches(cookieDomain: string, host: string): boolean {
  if (!cookieDomain) return true;
  const cd = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
  const h = host.toLowerCase();
  return h === cd || h.endsWith('.' + cd);
}

function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath || cookiePath === '/') return true;
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  // RFC 6265 §5.1.4: 前缀匹配时，cookie path 以 '/' 结尾，
  // 或请求路径的下一个字符是 '/' 才算匹配。
  return cookiePath.endsWith('/') || requestPath.charAt(cookiePath.length) === '/';
}

function secureMatches(cookie: SimpleCookie, url: string): boolean {
  if (!cookie.secure) return true;
  return url.startsWith('https:') || url.startsWith('wss:');
}

export class SimpleCookieJar {
  private cookies: SimpleCookie[] = [];
  private _dirty = true;

  isDirty(): boolean {
    return this._dirty;
  }

  markClean(): void {
    this._dirty = false;
  }

  async setCookie(
    cookieStr: string,
    url: string,
    options?: { readonly ignoreError?: boolean },
  ): Promise<void> {
    try {
      const parsed = parseSetCookie(cookieStr, url);
      if (!parsed) return;
      if (parsed.expires !== null && parsed.expires <= Math.floor(Date.now() / 1000)) {
        // Max-Age=0 / 已过期的 Set-Cookie 是删除指令：移除同 name+domain+path
        // 的条目，而不是存一个空值僵尸（僵尸会因"最长 path 优先"去重规则
        // 抢在真实 cookie 前被发出去，导致 CAS 收到空 CASTGC）。
        this.cookies = this.cookies.filter(
          (c) =>
            !(
              c.name === parsed.name &&
              c.domain === parsed.domain &&
              c.path === parsed.path
            ),
        );
        this._dirty = true;
        return;
      }
      this.cookies = this.cookies.filter(
        (c) =>
          !(
            c.name === parsed.name &&
            c.domain === parsed.domain &&
            c.path === parsed.path
          ),
      );
      this.cookies.push(parsed);
      this._dirty = true;
    } catch (e) {
      if (!options?.ignoreError) throw e;
    }
  }

  async getCookieString(url: string): Promise<string> {
    const parsedUrl = safeParseUrl(url);
    const host = parsedUrl?.hostname ?? '';
    const pathname = parsedUrl?.pathname ?? '/';
    const now = Math.floor(Date.now() / 1000);

    const matched = this.cookies.filter((c) => {
      if (c.value === '') return false; // 空值 cookie 无意义且会遮蔽同名真实值
      if (c.expires !== null && c.expires < now) return false;
      if (!domainMatches(c.domain, host)) return false;
      if (!pathMatches(c.path, pathname)) return false;
      if (!secureMatches(c, url)) return false;
      return true;
    });

    // Deduplicate by name: longest path wins (most specific match).
    matched.sort((a, b) => b.path.length - a.path.length);
    const seen = new Set<string>();
    const deduped = matched.filter((c) => {
      if (seen.has(c.name)) return false;
      seen.add(c.name);
      return true;
    });
    return deduped.map((c) => `${c.name}=${c.value}`).join('; ');
  }

  async getAllCookies(): Promise<readonly CookieEntry[]> {
    return this.cookies.map((c) => ({ ...c }));
  }

  async removeCookie(domain: string, path: string, key: string): Promise<void> {
    this.cookies = this.cookies.filter(
      (c) => !(c.domain === domain && c.path === path && c.name === key),
    );
    this._dirty = true;
  }

  toJSON(): string {
    return JSON.stringify(this.cookies, null, 2);
  }

  static fromJSON(s: string): SimpleCookieJar {
    const jar = new SimpleCookieJar();
    const data: unknown = JSON.parse(s);
    if (!Array.isArray(data)) return jar;
    for (const item of data) {
      if (item === null || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const name = typeof raw['name'] === 'string' ? raw['name'] : '';
      const value = typeof raw['value'] === 'string' ? raw['value'] : '';
      const domain = typeof raw['domain'] === 'string' ? raw['domain'] : '';
      const path = typeof raw['path'] === 'string' ? raw['path'] : '/';
      const secure = Boolean(raw['secure']);
      let expires: number | null = null;
      const expRaw = raw['expires'];
      if (typeof expRaw === 'number') {
        expires = Math.trunc(expRaw);
      } else if (typeof expRaw === 'string' && expRaw !== '') {
        const n = Number(expRaw);
        if (Number.isFinite(n)) expires = Math.trunc(n);
      }
      if (name) {
        jar.cookies.push({ name, value, domain, path, secure, expires });
      }
    }
    return jar;
  }
}

// ─── Fetch helper ─────────────────────────────────────────────────────── //

export interface HttpRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | URLSearchParams;
  readonly redirect: 'manual' | 'follow';
  readonly timeoutMs?: number;
  /**
   * 可选中止信号。Web 传输层（proxyHttpSend）真实取消请求；
   * CapacitorHttp 不支持中止 in-flight 请求，仅在发送前检查
   * （已中止则直接抛错），已发出的请求结果由调用方丢弃。
   */
  readonly signal?: AbortSignal;
  /** Passed to CapacitorHttp as responseType (e.g. 'base64' for binary data). */
  readonly responseType?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[]>>;
  readonly url: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 10;

export async function fetchWithJar(
  jar: SimpleCookieJar,
  req: HttpRequest,
): Promise<HttpResponse> {
  if (req.redirect === 'manual') {
    return send(jar, req);
  }
  return followRedirects(jar, req);
}

/**
 * 无会话请求：走平台传输层（原生 CapacitorHttp / Web 边缘代理），
 * 但使用一次性 jar，不读写任何持久 cookie。
 * 用于微信扫码登录等与教务会话无关的第三方端点。
 */
export async function fetchStateless(req: HttpRequest): Promise<HttpResponse> {
  return fetchWithJar(new SimpleCookieJar(), req);
}

import { isCapacitor } from './native/platform';
import { getCustomUserAgent } from './custom-user-agent';
import { useActivationStore } from './stores/activation';

// Cache Capacitor core module to avoid dynamic import overhead on every request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capCoreCache: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCapacitorCore(): Promise<any> {
  if (!capCoreCache) capCoreCache = await import('@capacitor/core');
  return capCoreCache;
}

async function send(jar: SimpleCookieJar, req: HttpRequest): Promise<HttpResponse> {
  if (isCapacitor()) {
    return capacitorHttpSend(jar, req);
  }
  // Web 端无法直连教务系统（CORS + Cookie/User-Agent/Referer 为浏览器
  // forbidden header），统一走 EdgeOne 边缘函数代理。
  return proxyHttpSend(jar, req);
}

/**
 * Web 端传输：经 EdgeOne 代理转发（协议见 website/edge-functions/api/proxy.js）。
 * 浏览器禁改的头部经 x-proxy-* 映射；上游状态码经 x-proxy-status 回传
 * （浏览器 fetch redirect:'manual' 会把 3xx 变成 opaqueredirect 隐藏 Location，
 * 因此代理对浏览器恒返回 200）。
 *
 * 代理基址默认同源 /api/proxy（App 与代理部署在同一 EdgeOne Pages 站点）；
 * 本地开发用 NEXT_PUBLIC_PROXY_BASE_URL 指向已部署的代理，
 * 例如 https://ysu.welain.com/api/proxy 。
 */
/**
 * 激活接口地址：与代理同站点的 /api/activate；本地开发经
 * NEXT_PUBLIC_PROXY_BASE_URL 推导到已部署站点（见 proxyHttpSend 注释）。
 */
export function getActivateUrl(): string {
  const base = process.env.NEXT_PUBLIC_PROXY_BASE_URL;
  if (base) {
    return base.replace(/\/api\/proxy\/?$/, '/api/activate');
  }
  return '/api/activate';
}

async function proxyHttpSend(
  jar: SimpleCookieJar,
  req: HttpRequest,
): Promise<HttpResponse> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    const lower = k.toLowerCase();
    if (lower === 'cookie') continue; // jar 是唯一 cookie 来源
    if (lower === 'user-agent') {
      headers.set('x-proxy-ua', v);
    } else if (lower === 'referer') {
      headers.set('x-proxy-referer', v);
    } else if (lower === 'origin') {
      headers.set('x-proxy-origin', v);
    } else if (
      lower === 'accept-encoding' ||
      lower === 'host' ||
      lower === 'content-length' ||
      lower === 'connection'
    ) {
      continue;
    } else {
      headers.set(k, v);
    }
  }
  if (!headers.has('x-proxy-ua')) {
    headers.set('x-proxy-ua', getCustomUserAgent());
  }
  if (!headers.has('accept')) {
    headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
  }
  if (!headers.has('accept-language')) {
    headers.set('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  }
  const cookieHeader = await jar.getCookieString(req.url);
  if (cookieHeader) {
    headers.set('x-proxy-cookie', cookieHeader);
  }
  // Web 激活凭证：proxy 配置 ACTIVATION_TOKEN 后逐请求校验（见 proxy.js）
  const activationToken = useActivationStore.getState().token;
  if (activationToken) {
    headers.set('x-activation', activationToken);
  }

  const proxyBase = process.env.NEXT_PUBLIC_PROXY_BASE_URL || '/api/proxy';
  const proxyUrl = `${proxyBase}?url=${encodeURIComponent(req.url)}`;
  const response = await fetch(proxyUrl, {
    method: req.method,
    headers,
    body: req.body,
    // 代理恒返回 200，不存在需要浏览器处理的重定向
    redirect: 'follow',
    signal: req.signal
      ? AbortSignal.any([
          AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          req.signal,
        ])
      : AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // token 被服务端轮换/吊销：清除本地凭证，ActivationGate 回落到激活页
    if (response.status === 403 && detail.includes('ACTIVATION_REQUIRED')) {
      useActivationStore.getState().clearToken();
    }
    throw new Error(`proxy request failed: HTTP ${response.status} ${detail}`);
  }

  // 上游 Set-Cookie（base64(JSON) 分片）回装 jar；域名归属按上游 URL 解析
  let parsedSetCookies: string[] = [];
  const encodedSetCookie = response.headers.get('x-proxy-set-cookie');
  if (encodedSetCookie) {
    try {
      const b64 = encodedSetCookie.split(', ').join('');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const setCookies: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (Array.isArray(setCookies)) {
        parsedSetCookies = setCookies.filter((s): s is string => typeof s === 'string');
        for (const sc of parsedSetCookies) {
          await jar.setCookie(sc, req.url, { ignoreError: true });
        }
      }
    } catch {
      // 代理头损坏不致命，忽略
    }
  }

  const respHeaders: Record<string, string | string[]> = {};
  for (const [k, v] of response.headers.entries()) {
    const lower = k.toLowerCase();
    if (lower === 'x-proxy-set-cookie' || lower === 'x-proxy-status') continue;
    if (lower.startsWith('access-control-')) continue;
    respHeaders[lower] = v;
  }
  if (parsedSetCookies.length > 0) {
    respHeaders['set-cookie'] = parsedSetCookies;
  }

  const realStatus = Number(response.headers.get('x-proxy-status')) || response.status;

  return {
    status: realStatus,
    headers: respHeaders,
    url: req.url,
    text: () => response.clone().text(),
    arrayBuffer: () => response.arrayBuffer(),
  };
}

async function capacitorHttpSend(
  jar: SimpleCookieJar,
  req: HttpRequest,
): Promise<HttpResponse> {
  const capCore = await getCapacitorCore();
  const CapacitorHttp = capCore?.CapacitorHttp;
  const CapacitorCookies = capCore?.CapacitorCookies;
  if (!CapacitorHttp?.request) {
    throw new Error('CapacitorHttp not available');
  }
  // CapacitorHttp 不支持中止 in-flight 请求；发送前检查，已中止直接抛错。
  if (req.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  // Push jar cookies → native store so HttpURLConnection sends them.
  // Only push when jar is dirty (cookies changed since last push).
  if (jar.isDirty()) {
    const jarCookies = await jar.getAllCookies();
    for (const c of jarCookies) {
      if (!c.value) continue;
      try {
        const host = c.domain.replace(/^\./, '') || 'localhost';
        await CapacitorCookies?.setCookie?.({
          url: `https://${host}${c.path}`,
          key: c.name,
          value: c.value,
          path: c.path,
        });
      } catch { /* ignore individual failures */ }
    }
    jar.markClean();
  }

  const headers: Record<string, string> = { ...(req.headers ?? {}) };
  if (!hasHeader(headers, 'User-Agent')) {
    headers['User-Agent'] = getCustomUserAgent();
  }
  if (!hasHeader(headers, 'Accept')) {
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  }
  if (!hasHeader(headers, 'Accept-Language')) {
    headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8';
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const options: Record<string, any> = {
    method: req.method,
    url: req.url,
    headers,
    connectTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    readTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    disableRedirects: true,
    responseType: req.responseType ?? 'text',
  };

  if (req.body !== undefined) {
    options.data = req.body instanceof URLSearchParams ? req.body.toString() : req.body;
  }

  const response = await CapacitorHttp.request(options);

  // CapacitorHttp preserves original header casing from the server.
  // Normalize all keys to lowercase so consumers can access uniformly.
  const rawHeaders: Record<string, string> = response.headers ?? {};
  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    normalizedHeaders[k.toLowerCase()] = v;
  }

  const setCookieRaw = normalizedHeaders['set-cookie'];
  if (setCookieRaw) {
    const cookies = Array.isArray(setCookieRaw)
      ? setCookieRaw
      : splitSetCookie(setCookieRaw);
    for (const sc of cookies) {
      await jar.setCookie(sc, req.url, { ignoreError: true });
    }
  }

  // Read back cookies from the native CookieManager.
  // When HttpURLConnection auto-follows redirects, it captures Set-Cookie headers
  // (e.g. GS_SESSIONID from JWXT) in its native store. These are NOT exposed in
  // the response headers JS sees. Sync them back into our jar.
  try {
    const nativeCookies: Record<string, string> =
      await CapacitorCookies?.getCookies?.({ url: req.url });
    if (nativeCookies && typeof nativeCookies === 'object') {
      const jarAll = await jar.getAllCookies();
      const jarNames = new Set(jarAll.filter((c) => c.value).map((c) => c.name));
      for (const [name, value] of Object.entries(nativeCookies)) {
        if (!value || jarNames.has(name)) continue;
        // Cookie exists in native store but not in our jar — add it.
        // We lack domain/path info; set with request URL's domain as hint.
        const parsedUrl = safeParseUrl(req.url);
        const domain = parsedUrl?.hostname ?? '';
        const path = parsedUrl?.pathname ?? '/';
        await jar.setCookie(
          `${name}=${value}; Domain=${domain}; Path=${path}`,
          req.url,
          { ignoreError: true },
        );
      }
    }
  } catch {
    // Not on Capacitor or getCookies not available
  }

  const isBase64 = req.responseType === 'base64';

  return {
    status: response.status,
    headers: normalizedHeaders,
    url: response.url || req.url,
    text: async () => {
      const d = response.data;
      if (d === null || d === undefined) return '';
      if (typeof d === 'string') return d;
      // CapacitorHttp auto-parses JSON responses into objects even with
      // responseType:'text'. Re-serialize so callers can JSON.parse the text.
      if (typeof d === 'object') return JSON.stringify(d);
      return String(d);
    },
    arrayBuffer: async () => {
      if (isBase64) {
        // response.data is a base64 string — decode to binary
        const binary = atob(String(response.data ?? ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
      }
      const encoder = new TextEncoder();
      return encoder.encode(String(response.data ?? '')).buffer;
    },
  };
}

async function followRedirects(
  jar: SimpleCookieJar,
  req: HttpRequest,
): Promise<HttpResponse> {
  let currentUrl = req.url;
  let currentMethod = req.method;
  let currentBody = req.body;
  let currentHeaders = req.headers;

  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const resp = await send(jar, {
      method: currentMethod,
      url: currentUrl,
      headers: currentHeaders,
      body: currentBody,
      redirect: 'manual',
      timeoutMs: req.timeoutMs,
    });

    if (resp.status < 300 || resp.status >= 400) {
      return resp;
    }

    const location = headerSingle(resp.headers, 'location');
    if (!location) {
      return resp;
    }

    currentUrl = new URL(location, currentUrl).toString();

    if (
      resp.status === 303 ||
      ((resp.status === 301 || resp.status === 302) && currentMethod === 'POST')
    ) {
      currentMethod = 'GET';
      currentBody = undefined;
      currentHeaders = stripBodyHeaders(currentHeaders);
    }
  }

  throw new Error(`exceeded max redirects (${MAX_REDIRECTS}) for ${req.url}`);
}

function splitSetCookie(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  let current = raw;
  while (current.length > 0) {
    let splitIdx = -1;
    for (let i = 0; i < current.length; i++) {
      if (current[i] === ',') {
        const after = current.slice(i + 1).trim();
        // 新的 cookie 以 name=value 开头
        if (/^[a-zA-Z0-9_-]+=/.test(after)) {
          splitIdx = i;
          break;
        }
      }
    }
    if (splitIdx === -1) {
      out.push(current.trim());
      break;
    }
    out.push(current.slice(0, splitIdx).trim());
    current = current.slice(splitIdx + 1).trim();
  }
  return out;
}

function stripBodyHeaders(
  headers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === 'content-type' || lower === 'content-length') continue;
    out[k] = v;
  }
  return out;
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
