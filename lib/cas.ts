/**
 * CAS 认证模块 —— 燕山大学统一身份认证网关。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import {
  SimpleCookieJar,
  CookieEntry,
  collectCookies,
  installCookies,
  cookieEntryFromJSON,
  fetchWithJar,
  headerSingle,
  type HttpResponse,
} from './cookie';
import {
  saveCASTGC as saveCASTGCSecure,
  loadCASTGC,
} from './secure-storage';

// ─── Constants ────────────────────────────────────────────────────────── //

const CER_BASE_URL = 'https://cer.ysu.edu.cn';
const AUTH_LOGIN_URL = `${CER_BASE_URL}/authserver/login`;
const AUTH_INDEX_URL = `${CER_BASE_URL}/authserver/index.do`;
const CHECK_CAPTCHA_URL = `${CER_BASE_URL}/authserver/checkNeedCaptcha.htl`;
const REAUTH_TYPE_URL = `${CER_BASE_URL}/authserver/reAuthCheck/changeReAuthType.do`;
const REAUTH_SEND_CODE_URL = `${CER_BASE_URL}/authserver/dynamicCode/getDynamicCodeByReauth.do`;
const REAUTH_SUBMIT_URL = `${CER_BASE_URL}/authserver/reAuthCheck/reAuthSubmit.do`;
const DEFAULT_LOGIN_SERVICE = `${CER_BASE_URL}/personalInfo/personCenter/index.html`;
const AES_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
const MFA_METHOD_TO_CODE: Readonly<Record<string, string>> = {
  sms: '3',
  cpdaily: '5',
};
const MFA_METHOD_TO_AUTH_CODE_TYPE: Readonly<Record<string, string>> = {
  sms: 'reAuthDynamicCodeType',
  cpdaily: 'reAuthCpdailyDynamicCodeType',
};
const CAS_COOKIE_DOMAIN = 'cer.ysu.edu.cn';
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

// ─── Types ────────────────────────────────────────────────────────────── //

export type MFAMethod = 'sms' | 'cpdaily';

export interface MFAChallenge {
  readonly method: MFAMethod;
  readonly methodCode: string;
  readonly mobileHint: string;
  readonly username: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface Step1Result {
  readonly authenticated: boolean;
  readonly needsMfa: boolean;
  readonly username: string;
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class CASError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'CASError';
  }
}

export class NeedCaptchaError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'NeedCaptchaError';
  }
}

export class IPBlockedError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'IPBlockedError';
  }
}

export class LoginFailedError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'LoginFailedError';
  }
}

export class MFARequiredError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'MFARequiredError';
  }
}

export class MFAFailedError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'MFAFailedError';
  }
}

export class NotAuthenticatedError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export class CASProtocolError extends CASError {
  constructor(message?: string) {
    super(message);
    this.name = 'CASProtocolError';
  }
}

// ─── CASCredential ────────────────────────────────────────────────────── //

const ALLOWED_PATH_PREFIX = '/authserver';

function isCasPath(p: string): boolean {
  if (!p) return true;
  return p === '/' || p.startsWith(ALLOWED_PATH_PREFIX);
}

function isCasCookie(e: CookieEntry): boolean {
  const domain = e.domain.startsWith('.') ? e.domain.slice(1) : e.domain;
  return domain === CAS_COOKIE_DOMAIN && isCasPath(e.path);
}

export class CASCredential {
  constructor(public readonly cookies: readonly CookieEntry[]) {}

  static async fromJar(jar: SimpleCookieJar): Promise<CASCredential> {
    return new CASCredential(await collectCookies(jar, isCasCookie));
  }

  async apply(jar: SimpleCookieJar): Promise<void> {
    await installCookies(jar, this.cookies);
  }

  toJSON(): string {
    return JSON.stringify(
      { cookies: this.cookies.map((c) => ({ ...c })) },
      null,
      2,
    );
  }

  static fromJSON(s: string): CASCredential {
    const data: unknown = JSON.parse(s);
    if (data === null || typeof data !== 'object' || !('cookies' in data)) {
      throw new Error("invalid CASCredential JSON: missing 'cookies'");
    }
    const rawCookies = (data as { cookies: unknown }).cookies;
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid CASCredential JSON: 'cookies' must be a list");
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (item === null || typeof item !== 'object') {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`);
      }
      const e = cookieEntryFromJSON(item as Record<string, unknown>);
      if (!e.domain) {
        return { ...e, domain: CAS_COOKIE_DOMAIN };
      }
      return e;
    });
    return new CASCredential(entries);
  }
}

// ─── Crypto ───────────────────────────────────────────────────────────── //

const VALID_AES_KEY_BYTES: ReadonlySet<number> = new Set([16, 24, 32]);
const ALPHABET_LEN = AES_CHARS.length;
const REJECTION_THRESHOLD = Math.floor(256 / ALPHABET_LEN) * ALPHABET_LEN;

export function _randomString(length: number): string {
  const out: string[] = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!;
      if (b < REJECTION_THRESHOLD) {
        out.push(AES_CHARS[b % ALPHABET_LEN]!);
      }
    }
  }
  return out.join('');
}

export async function encryptPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(salt);
  if (!VALID_AES_KEY_BYTES.has(keyBytes.length)) {
    throw new CASProtocolError(
      `unexpected pwdEncryptSalt length: ${keyBytes.length} bytes` +
        ` (expected one of ${[...VALID_AES_KEY_BYTES].sort((a, b) => a - b).join(', ')})`,
    );
  }

  const data = encoder.encode(_randomString(64) + password);
  const iv = encoder.encode(_randomString(16));

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-CBC' },
    false,
    ['encrypt'],
  );
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    data,
  );
  return bytesToBase64(new Uint8Array(cipherBuffer));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ─── Parser (DOMParser, no linkedom) ──────────────────────────────────── //

const REAUTH_KEYWORDS: readonly string[] = [
  'reAuthCheck',
  'Multifactor',
  'reAuthType',
  '二次认证',
];

const IP_FROZEN_KEYWORDS: readonly string[] = [
  'IP freeze',
  'has been blocked',
  'IP被冻结',
];

const ERROR_SELECTORS: readonly string[] = [
  '#showErrorTip',
  '.form-errorTip',
  '.help-block',
  '.reauth_error_submit',
];

export function extractHiddenFields(
  html: string,
  options: { readonly cllt?: string } = {},
): Record<string, string> {
  const document = new DOMParser().parseFromString(html, 'text/html');

  let containers: Element[];
  const allForms = Array.from(document.querySelectorAll('form'));
  if (allForms.length === 0) {
    containers = [document.documentElement];
  } else if (options.cllt !== undefined) {
    containers = allForms.filter((f) => {
      const cllt = f.querySelector('input[name="cllt"]');
      return cllt !== null && cllt.getAttribute('value') === options.cllt;
    });
  } else {
    containers = allForms;
  }

  const fields: Record<string, string> = {};
  for (const container of containers) {
    for (const inp of container.querySelectorAll('input')) {
      const type = inp.getAttribute('type')?.toLowerCase();
      if (type !== 'hidden') continue;
      const key = inp.getAttribute('name') ?? inp.getAttribute('id');
      if (!key) continue;
      fields[key] = inp.getAttribute('value') ?? '';
    }
  }
  return fields;
}

export function isReauthPage(html: string): boolean {
  return REAUTH_KEYWORDS.some((k) => html.includes(k));
}

export function isIpFrozen(html: string): boolean {
  return IP_FROZEN_KEYWORDS.some((k) => html.includes(k));
}

export function extractErrorMessage(html: string): string | null {
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const selector of ERROR_SELECTORS) {
    const el = document.querySelector(selector);
    if (el === null) continue;
    const text = el.textContent?.trim();
    if (text) return text;
  }
  return null;
}

// ─── Module state ─────────────────────────────────────────────────────── //

let casJar = new SimpleCookieJar();
let timeoutMs = 30_000;
let credentialApplied: Promise<void> = Promise.resolve();

export function getJar(): SimpleCookieJar {
  return casJar;
}

export function setJar(jar: SimpleCookieJar): void {
  casJar = jar;
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms;
}

export function resetCAS(): void {
  casJar = new SimpleCookieJar();
  credentialApplied = Promise.resolve();
}

export async function restoreCredential(credential: CASCredential): Promise<void> {
  credentialApplied = credential.apply(casJar);
  await credentialApplied;
}

export function getCredentialApplied(): Promise<void> {
  return credentialApplied;
}

/**
 * Save CASTGC from jar to secure storage for cross-restart persistence.
 */
export async function saveCASTGC(): Promise<void> {
  const allCookies = await casJar.getAllCookies();
  for (const c of allCookies) {
    if (c.name === 'CASTGC' && c.value) {
      await saveCASTGCSecure(c.value);
      return;
    }
  }
}

/**
 * Restore CASTGC from secure storage into the CapacitorHttp system cookie store.
 * Must be called on startup before any CAS requests.
 */
export async function restoreCASCookies(): Promise<void> {
  const tgc = await loadCASTGC();
  if (!tgc) return;

  try {
    const capCore = (await import('@capacitor/core')) as Record<string, unknown>;
    const CapacitorCookies = capCore['CapacitorCookies'] as {
      setCookie?: (opts: { url: string; key: string; value: string; path?: string }) => Promise<void>;
    } | undefined;
    if (CapacitorCookies?.setCookie) {
      await CapacitorCookies.setCookie({
        url: CER_BASE_URL,
        key: 'CASTGC',
        value: tgc,
        path: '/authserver',
      });
    }
  } catch {
    // Not on Capacitor — ignore
  }
}

// ─── Internal fetch wrapper ───────────────────────────────────────────── //

async function _fetch(req: Parameters<typeof fetchWithJar>[1]): Promise<HttpResponse> {
  await credentialApplied;
  return fetchWithJar(casJar, req);
}

// ─── Public API ───────────────────────────────────────────────────────── //

/** 访问登录页以建立 CAS session (获取 JSESSIONID cookie)。 */
export async function prepareLogin(): Promise<void> {
  await getLoginPage();
  // Sync JSESSIONID from jar → WebView cookie store so that
  // <img src="getCaptcha.htl"> uses the same session as the login POST.
  await syncJarCookiesToWebView();
}

async function syncJarCookiesToWebView(): Promise<void> {
  try {
    const capCore = (await import('@capacitor/core')) as Record<string, unknown>;
    const CapacitorCookies = capCore['CapacitorCookies'] as {
      setCookie?: (opts: { url: string; key: string; value: string; path?: string }) => Promise<void>;
    } | undefined;
    if (!CapacitorCookies?.setCookie) return;
    const cookies = await casJar.getAllCookies();
    for (const c of cookies) {
      if (!c.value) continue;
      const host = c.domain.replace(/^\./, '');
      if (!host.includes('cer.ysu.edu.cn')) continue;
      await CapacitorCookies.setCookie({
        url: `https://${host}${c.path}`,
        key: c.name,
        value: c.value,
        path: c.path,
      });
    }
  } catch {
    // Not on Capacitor — ignore
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const resp = await _fetch({
    method: 'GET',
    url: AUTH_INDEX_URL,
    redirect: 'manual',
    timeoutMs,
  });
  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, 'location') ?? '';
    return !location.includes('/authserver/login');
  }
  if (resp.status === 200) {
    // CapacitorHttp auto-follows redirects — check final URL
    return !resp.url.includes('/authserver/login');
  }
  return false;
}

export async function credential(): Promise<CASCredential> {
  return CASCredential.fromJar(casJar);
}

/** 检查指定用户是否需要验证码。不获取图片——图片由 `<img>` 直接加载。 */
export async function checkCaptchaNeeded(username: string): Promise<boolean> {
  const checkUrl = `${CHECK_CAPTCHA_URL}?username=${encodeURIComponent(username)}`;
  try {
    const resp = await _fetch({
      method: 'GET',
      url: checkUrl,
      redirect: 'manual',
      timeoutMs: Math.min(timeoutMs, 10_000),
    });
    const data = JSON.parse(await resp.text()) as Record<string, unknown>;
    return Boolean(data['isNeed']);
  } catch {
    return false;
  }
}

export async function loginStep1(
  username: string,
  password: string,
  options: { readonly captcha?: string } = {},
): Promise<Step1Result> {
  const { html, finalUrl } = await getLoginPage();

  // If we landed on the service page (not the login page), already authenticated.
  if (!finalUrl.includes('/authserver/login')) {
    return { authenticated: true, needsMfa: false, username };
  }

  const fields = extractHiddenFields(html, { cllt: 'userNameLogin' });
  const execution = fields['execution'];
  const salt = fields['pwdEncryptSalt'];
  if (!execution) {
    throw new CASProtocolError("login page missing 'execution' field");
  }
  if (!salt) {
    throw new CASProtocolError("login page missing 'pwdEncryptSalt' field");
  }

  const encrypted = await encryptPassword(password, salt);

  const body = new URLSearchParams({
    username,
    password: encrypted,
    captcha: options.captcha ?? '',
    _eventId: 'submit',
    cllt: 'userNameLogin',
    dllt: 'generalLogin',
    lt: '',
    execution,
    rememberMe: 'true',
  });

  const encodedService = encodeURIComponent(DEFAULT_LOGIN_SERVICE);
  const loginUrl = `${AUTH_LOGIN_URL}?service=${encodedService}&_=${Date.now()}`;
  const resp = await _fetch({
    method: 'POST',
    url: loginUrl,
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: CER_BASE_URL,
      Referer: `${AUTH_LOGIN_URL}?service=${encodedService}`,
    },
    redirect: 'manual',
    timeoutMs,
  });
  const result = await classifyStep1Response(resp, username);
  if (result.authenticated) {
    loginPageCache = null;
    await saveCASTGC();
  }
  return result;
}

export async function requestMFACode(
  username: string,
  method: MFAMethod = 'cpdaily',
): Promise<MFAChallenge> {
  const typeCode = MFA_METHOD_TO_CODE[method];
  const authCodeType = MFA_METHOD_TO_AUTH_CODE_TYPE[method];
  if (!typeCode || !authCodeType) {
    throw new CASProtocolError(`unsupported MFA method: ${method}`);
  }

  const encodedService = encodeURIComponent(DEFAULT_LOGIN_SERVICE);
  const referer = `${CER_BASE_URL}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`;

  await _fetch({
    method: 'POST',
    url: REAUTH_TYPE_URL,
    body: new URLSearchParams({
      isMultifactor: 'true',
      reAuthType: typeCode,
      service: DEFAULT_LOGIN_SERVICE,
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: referer,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
    timeoutMs: Math.min(timeoutMs, 15_000),
  });

  const resp = await _fetch({
    method: 'POST',
    url: REAUTH_SEND_CODE_URL,
    body: new URLSearchParams({
      userName: username,
      authCodeTypeName: authCodeType,
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: referer,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
    timeoutMs: Math.min(timeoutMs, 15_000),
  });

  const rawText = await resp.text();
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new CASProtocolError(
      `reauth send-code returned non-JSON: ${rawText.slice(0, 200)}`,
    );
  }

  const res = typeof result['res'] === 'string' ? result['res'] : '';
  const msg = typeof result['returnMessage'] === 'string' ? result['returnMessage'] : '';

  if (res === 'success' || res === 'cpdaily_success' || res === 'wechat_success') {
    return {
      method,
      methodCode: typeCode,
      mobileHint: typeof result['mobile'] === 'string' ? result['mobile'] : '',
      username,
      raw: result,
    };
  }
  if (res === 'code_time_fail') {
    throw new MFAFailedError(`send too frequent: ${msg}`);
  }
  throw new CASProtocolError(
    `unexpected reauth send-code response: res=${JSON.stringify(res)} msg=${JSON.stringify(msg)}`,
  );
}

export async function submitMFACode(
  challenge: MFAChallenge,
  code: string,
): Promise<CASCredential> {
  const encodedService = encodeURIComponent(DEFAULT_LOGIN_SERVICE);
  const referer = `${CER_BASE_URL}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`;
  const resp = await _fetch({
    method: 'POST',
    url: REAUTH_SUBMIT_URL,
    body: new URLSearchParams({
      service: DEFAULT_LOGIN_SERVICE,
      reAuthType: challenge.methodCode,
      isMultifactor: 'true',
      dynamicCode: code,
      password: '',
      uuid: '',
      answer1: '',
      answer2: '',
      otpCode: '',
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: referer,
      'X-Requested-With': 'XMLHttpRequest',
    },
    redirect: 'manual',
    timeoutMs,
  });

  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, 'location') ?? '';
    try {
      const follow = await _fetch({
        method: 'GET',
        url: new URL(location, REAUTH_SUBMIT_URL).toString(),
        redirect: 'follow',
        timeoutMs,
      });
      if (!follow.url.includes('/authserver/login')) {
        await saveCASTGC();
        return credential();
      }
    } catch {
      if (location.includes('ticket=') && !location.includes('/authserver/login')) {
        await saveCASTGC();
        return credential();
      }
    }
  }

  if (resp.status === 200) {
    const text = await resp.text();
    try {
      const result = JSON.parse(text) as Record<string, unknown>;
      const codeField = result['code'] ?? result['res'];
      if (codeField === 'reAuth_failed' || codeField === 'reAuth_unauthorized') {
        throw new MFAFailedError(`server rejected MFA code: ${JSON.stringify(result)}`);
      }
    } catch (e) {
      if (e instanceof MFAFailedError) throw e;
    }

    const hasFailureMarker =
      text.includes('reauth_error_submit') ||
      text.includes('reAuth_failed') ||
      text.includes('reAuth_unauthorized');
    const hasSuccessMarker =
      text.includes('reAuth_success') || text.includes('loginSuccess');
    if (hasFailureMarker && !hasSuccessMarker) {
      throw new MFAFailedError('MFA page reported failure');
    }
  }

  if (await isAuthenticated()) {
    await saveCASTGC();
    return credential();
  }

  throw new MFAFailedError('MFA submission did not produce a valid session');
}

export async function authorize(
  serviceUrl: string,
  targetJar?: SimpleCookieJar,
): Promise<SimpleCookieJar> {
  const target = targetJar ?? new SimpleCookieJar();
  await (await CASCredential.fromJar(casJar)).apply(target);

  const encoded = encodeURIComponent(serviceUrl);
  const url = `${AUTH_LOGIN_URL}?service=${encoded}`;

  let resp: HttpResponse;
  try {
    resp = await fetchWithJar(target, {
      method: 'GET',
      url,
      redirect: 'follow',
      timeoutMs,
    });
  } catch (e) {
    throw new CASProtocolError(`authorize redirect chain failed: ${(e as Error).message}`);
  }

  if (resp.url.includes('/authserver/login')) {
    throw new NotAuthenticatedError('CAS bounced back to login page; TGC missing or expired');
  }

  await (await CASCredential.fromJar(target)).apply(casJar);
  await saveCASTGC();

  return target;
}

// ─── Internal helpers ─────────────────────────────────────────────────── //

let loginPageCache: { html: string; finalUrl: string; ts: number } | null = null;
let loginPageInflight: Promise<{ html: string; finalUrl: string }> | null = null;
const LOGIN_PAGE_CACHE_TTL = 300_000;

async function getLoginPage(): Promise<{ html: string; finalUrl: string }> {
  if (loginPageCache && Date.now() - loginPageCache.ts < LOGIN_PAGE_CACHE_TTL) {
    return { html: loginPageCache.html, finalUrl: loginPageCache.finalUrl };
  }
  if (loginPageInflight) {
    return loginPageInflight;
  }

  loginPageInflight = (async () => {
    try {
      loginPageCache = null;
      const url = `${AUTH_LOGIN_URL}?service=${encodeURIComponent(DEFAULT_LOGIN_SERVICE)}`;

  // Follow redirects so we land on the actual destination.
  // If TGC is valid, CAS 302s to the service page (already authenticated).
  // If TGC is stale, CAS 302s to login with a fresh session cookie.
  let resp = await _fetch({
    method: 'GET',
    url,
    redirect: 'follow',
    timeoutMs,
  });

  if (resp.url.includes('/authserver/login')) {
    // TGC was stale — CAS bounced us back to login.
    // Clear the stale TGC and retry to get a clean login page.
    const staleTgc = await collectCookies(casJar, (e) => e.name === 'CASTGC');
    for (const c of staleTgc) {
      await casJar.removeCookie(c.domain, c.path, c.name);
    }
    resp = await _fetch({
      method: 'GET',
      url,
      redirect: 'follow',
      timeoutMs,
    });
    if (resp.url.includes('/authserver/login')) {
      const body = await resp.text();
      if (resp.status !== 200) {
        throw new CASProtocolError(`login page returned status ${resp.status}`);
      }
      const result = { html: body, finalUrl: resp.url };
      loginPageCache = { ...result, ts: Date.now() };
      return result;
    }
  }

  // Either already authenticated (landed on service page) or
  // a non-login destination. Return as-is.
  const result = { html: await resp.text(), finalUrl: resp.url };
  loginPageCache = { ...result, ts: Date.now() };
  return result;
    } finally {
      loginPageInflight = null;
    }
  })();

  return loginPageInflight;
}

async function classifyStep1Response(
  resp: HttpResponse,
  username: string,
): Promise<Step1Result> {
  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, 'location') ?? '';
    const absoluteLocation = new URL(location, AUTH_LOGIN_URL).toString();

    if (location.includes('reAuthCheck') || location.includes('isMultifactor')) {
      await _fetch({
        method: 'GET',
        url: absoluteLocation,
        redirect: 'manual',
        timeoutMs,
      });
      return { authenticated: false, needsMfa: true, username };
    }

    if (location.includes(DEFAULT_LOGIN_SERVICE) || location.includes('ticket=')) {
      await _fetch({
        method: 'GET',
        url: absoluteLocation,
        redirect: 'manual',
        timeoutMs,
      });
      return { authenticated: true, needsMfa: false, username };
    }

    let follow: HttpResponse;
    try {
      follow = await _fetch({
        method: 'GET',
        url: absoluteLocation,
        redirect: 'follow',
        timeoutMs,
      });
    } catch (e) {
      throw new CASProtocolError(`failed to follow redirect: ${(e as Error).message}`);
    }

    if (follow.url.includes(DEFAULT_LOGIN_SERVICE) || follow.url.includes('ticket=')) {
      return { authenticated: true, needsMfa: false, username };
    }

    const followText = await follow.text();

    if (isReauthPage(followText)) {
      return { authenticated: false, needsMfa: true, username };
    }

    // Redirect back to login page — authentication failed.
    if (follow.url.includes('/authserver/login')) {
      if (isIpFrozen(followText)) {
        throw new IPBlockedError('IP 被认证网关冻结,请稍后再试或联系管理员');
      }
      const error = extractErrorMessage(followText);
      if (error) {
        if (error.includes('验证码') || error.toLowerCase().includes('captcha')) {
          throw new NeedCaptchaError(error);
        }
        throw new LoginFailedError(error);
      }
      throw new LoginFailedError('登录失败(服务器未返回具体错误信息)');
    }

    throw new CASProtocolError(
      `unrecognized redirect chain after first-factor: ${follow.url}`,
    );
  }

  if (resp.status === 200) {
    const text = await resp.text();
    if (isIpFrozen(text)) {
      throw new IPBlockedError('IP 被认证网关冻结,请稍后再试或联系管理员');
    }
    if (isReauthPage(text)) {
      return { authenticated: false, needsMfa: true, username };
    }
    const error = extractErrorMessage(text);
    if (error) {
      if (error.includes('验证码') || error.toLowerCase().includes('captcha')) {
        throw new NeedCaptchaError(error);
      }
      throw new LoginFailedError(error);
    }
    throw new LoginFailedError(
      'first-factor authentication failed (no error message extracted)',
    );
  }

  // Unexpected status codes (e.g. 401, 403, 500) — read body for diagnostics.
  const body = await resp.text();
  if (isIpFrozen(body)) {
    throw new IPBlockedError('IP 被认证网关冻结,请稍后再试或联系管理员');
  }
  const error = extractErrorMessage(body);
  if (error) {
    if (error.includes('验证码') || error.toLowerCase().includes('captcha')) {
      throw new NeedCaptchaError(error);
    }
    throw new LoginFailedError(error);
  }
  throw new CASProtocolError(
    `unexpected status code from CAS: ${resp.status}` +
      (body ? ` — body snippet: ${body.slice(0, 300)}` : ''),
  );
}
