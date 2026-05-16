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
  return requestPath === cookiePath || requestPath.startsWith(cookiePath + '/');
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
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export async function fetchWithJar(
  jar: SimpleCookieJar,
  req: HttpRequest,
): Promise<HttpResponse> {
  if (req.redirect === 'manual') {
    return send(jar, req);
  }
  return followRedirects(jar, req);
}

import { isCapacitor } from './platform';

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

  const headers = new Headers(req.headers);
  if (!headers.has('accept')) {
    headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
  }
  if (!headers.has('accept-language')) {
    headers.set('accept-language', 'zh-CN,zh;q=0.9,en;q=0.8');
  }
  const cookieHeader = await jar.getCookieString(req.url);
  if (cookieHeader) {
    headers.set('cookie', cookieHeader);
  }

  const response = await fetch(req.url, {
    method: req.method,
    headers,
    body: req.body,
    redirect: 'manual',
    credentials: 'include',
    signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : splitSetCookie(response.headers.get('set-cookie') ?? '');

  for (const sc of setCookies) {
    await jar.setCookie(sc, req.url, { ignoreError: true });
  }

  return toHttpResponse(response, req.url);
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
  if (!headers['Accept']) {
    headers['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8';
  }
  if (!headers['Accept-Language']) {
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

function toHttpResponse(response: Response, requestUrl: string): HttpResponse {
  const headers: Record<string, string | string[]> = {};
  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : splitSetCookie(response.headers.get('set-cookie') ?? '');

  for (const [k, v] of response.headers.entries()) {
    const lowerK = k.toLowerCase();
    if (lowerK === 'set-cookie') continue;
    headers[lowerK] = v;
  }
  if (setCookies.length > 0) {
    headers['set-cookie'] = setCookies;
  }

  return {
    status: response.status,
    headers,
    url: response.url || requestUrl,
    text: () => response.text(),
    arrayBuffer: () => response.arrayBuffer(),
  };
}

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()];
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
