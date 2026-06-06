/**
 * CAS 认证模块 —— 燕山大学统一身份认证网关。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import { APP_VERSION } from "./version";
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
import {
  serverConfig,
  casUrls,
  getCasCookieDomain,
  getSchoolConfig,
} from './server-config';

// ─── Constants ────────────────────────────────────────────────────────── //

function getAESChars(): string {
  return getSchoolConfig().cas.aesChars;
}

function getMFAMethodToCode(): Readonly<Record<string, string>> {
  return getSchoolConfig().cas.mfaMethodToCode;
}

function getMFAMethodToAuthCodeType(): Readonly<Record<string, string>> {
  return getSchoolConfig().cas.mfaMethodToAuthCodeType;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

// CAS serves different reAuth pages based on User-Agent.
// The mobile version lacks WeChat MFA (only SMS/Cpdaily/WeChat Work).
// Use a desktop UA to get the PC reAuth flow with reAuthType=8 (WeChat).
const DESKTOP_UA =
  `Mozilla/5.0 (X11; Linux x86_64) ysu-client/${APP_VERSION}`;

// ─── Types ────────────────────────────────────────────────────────────── //

export type MFAMethod = 'sms' | 'cpdaily' | 'weixin';

export interface WechatMFAContext {
  uuid: string;
  state: string;
  qrImageUrl: string;
  /** The full WeChat OAuth authorization URL — open this to trigger the WeChat app. */
  oauthUrl: string;
}

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
  return domain === getCasCookieDomain() && isCasPath(e.path);
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
        return { ...e, domain: getCasCookieDomain() };
      }
      return e;
    });
    return new CASCredential(entries);
  }
}

// ─── Crypto ───────────────────────────────────────────────────────────── //

const VALID_AES_KEY_BYTES: ReadonlySet<number> = new Set([16, 24, 32]);

export function _randomString(length: number): string {
  const aesChars = getAESChars();
  const alphabetLen = aesChars.length;
  const rejectionThreshold = Math.floor(256 / alphabetLen) * alphabetLen;
  const out: string[] = [];
  const buf = new Uint8Array(length * 2);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!;
      if (b < rejectionThreshold) {
        out.push(aesChars[b % alphabetLen]!);
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

// Cache Capacitor core module to avoid dynamic import overhead.
let capCoreCache: typeof import('@capacitor/core') | null = null;
async function getCapacitorCore(): Promise<typeof import('@capacitor/core') | null> {
  if (capCoreCache) return capCoreCache;
  try {
    capCoreCache = await import('@capacitor/core');
    return capCoreCache;
  } catch {
    return null;
  }
}

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
  loginPageCache = null;
  loginPageInflight = null;
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

  const capCore = await getCapacitorCore();
  if (!capCore) return;

  const CapacitorCookies = (capCore as Record<string, unknown>)['CapacitorCookies'] as {
    setCookie?: (opts: { url: string; key: string; value: string; path?: string }) => Promise<void>;
  } | undefined;
  if (CapacitorCookies?.setCookie) {
    await CapacitorCookies.setCookie({
      url: serverConfig.cerBaseUrl,
      key: 'CASTGC',
      value: tgc,
      path: '/authserver',
    });
  }
}

/**
 * Logout CAS server session with CASTGC.
 */
export async function logoutCAS(): Promise<void> {
  let tgc = await loadCASTGC();
  if (!tgc) {
    const staleTgc = await collectCookies(casJar, (e) => e.name === 'CASTGC');
    tgc = staleTgc[0]?.value ?? '';
  }
  if (!tgc) return;

  const logoutJar = new SimpleCookieJar();
  await logoutJar.setCookie(
    `CASTGC=${tgc}; Domain=${getCasCookieDomain()}; Path=/authserver; Secure`,
    casUrls.authLogout,
    { ignoreError: true },
  );
  await fetchWithJar(logoutJar, {
    method: 'GET',
    url: casUrls.authLogout,
    redirect: 'follow',
    timeoutMs,
  });
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
  const capCore = await getCapacitorCore();
  if (!capCore) return;

  const CapacitorCookies = (capCore as Record<string, unknown>)['CapacitorCookies'] as {
    setCookie?: (opts: { url: string; key: string; value: string; path?: string }) => Promise<void>;
  } | undefined;
  if (!CapacitorCookies?.setCookie) return;
  const cookies = await casJar.getAllCookies();
  for (const c of cookies) {
    if (!c.value) continue;
    const host = c.domain.replace(/^\./, '');
    if (!host.includes(getCasCookieDomain())) continue;
    await CapacitorCookies.setCookie({
      url: `https://${host}${c.path}`,
      key: c.name,
      value: c.value,
      path: c.path,
    });
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const resp = await _fetch({
    method: 'GET',
    url: casUrls.authIndex,
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
  const checkUrl = `${casUrls.checkCaptcha}?username=${encodeURIComponent(username)}`;
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

  const encodedService = encodeURIComponent(casUrls.defaultLoginService);
  const loginUrl = `${casUrls.authLogin}?service=${encodedService}&_=${Date.now()}`;
  const resp = await _fetch({
    method: 'POST',
    url: loginUrl,
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: serverConfig.cerBaseUrl,
      Referer: `${casUrls.authLogin}?service=${encodedService}`,
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
  const typeCode = getMFAMethodToCode()[method];
  const authCodeType = getMFAMethodToAuthCodeType()[method];
  if (!typeCode || !authCodeType) {
    throw new CASProtocolError(`unsupported MFA method: ${method}`);
  }

  const encodedService = encodeURIComponent(casUrls.defaultLoginService);
  const referer = `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`;

  await _fetch({
    method: 'POST',
    url: casUrls.reauthType,
    body: new URLSearchParams({
      isMultifactor: 'true',
      reAuthType: typeCode,
      service: casUrls.defaultLoginService,
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
    url: casUrls.reauthSendCode,
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
  const encodedService = encodeURIComponent(casUrls.defaultLoginService);
  const referer = `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`;
  const resp = await _fetch({
    method: 'POST',
    url: casUrls.reauthSubmit,
    body: new URLSearchParams({
      service: casUrls.defaultLoginService,
      reAuthType: challenge.methodCode,
      isMultifactor: 'true',
      skipTmpReAuth: 'true',
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
        url: new URL(location, casUrls.reauthSubmit).toString(),
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

// ─── WeChat MFA ────────────────────────────────────────────────────── //

const WECHAT_POLL_BASE = 'https://lp.open.weixin.qq.com/connect/l/qrconnect';

export async function initiateWechatMFA(): Promise<WechatMFAContext> {
  const referer = `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true`;
  const success = encodeURIComponent(casUrls.defaultLoginService);

  // The mobile reAuth page does not support WeChat MFA (only SMS/Cpdaily).
  // Use a desktop Chrome UA so CAS serves the PC flow with reAuthType=8 (WeChat).
  // The `success` param matches handleGoCombined's logic when service is present.
  const resp = await _fetch({
    method: 'GET',
    url: `${casUrls.combinedLogin}?type=weixin&reAuth=2&success=${success}&skipTmpReAuth=true`,
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: referer,
    },
    redirect: 'manual',
    timeoutMs,
  });

  // Determine the WeChat OAuth URL.
  // - If we got a redirect, use the Location header.
  // - If CapacitorHttp followed the redirect (status 200 and resp.url points to WeChat), use resp.url.
  // - Otherwise check the body for a meta-refresh or JS redirect.
  let wxOAuthUrl: string;

  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, 'location');
    if (!location) {
      throw new CASProtocolError('combinedLogin.do returned redirect without Location header');
    }
    wxOAuthUrl = location;
  } else if (resp.status === 200) {
    if (resp.url.includes('open.weixin.qq.com')) {
      // CapacitorHttp auto-followed the redirect.
      wxOAuthUrl = resp.url;
    } else {
      // Server returned the combinedLogin page directly (200).
      // Try to extract the WeChat OAuth URL from the HTML body.
      const body = await resp.text();
      const metaMatch = body.match(/content="0;\s*url=([^"]+)"/i);
      if (metaMatch) {
        wxOAuthUrl = metaMatch[1]!;
      } else {
        throw new CASProtocolError(
          `combinedLogin.do returned status 200 without WeChat redirect. ` +
          `Body snippet: ${body.slice(0, 300)}`,
        );
      }
    }
  } else {
    throw new CASProtocolError(
      `unexpected status ${resp.status} from combinedLogin.do`,
    );
  }

  const wxUrl = new URL(wxOAuthUrl);
  const state = wxUrl.searchParams.get('state');
  if (!state) {
    throw new CASProtocolError('WeChat OAuth URL missing state parameter');
  }

  // Fetch the WeChat QR connect page to extract UUID from the QR image URL.
  // Only need the HTML — short timeout, no resources.
  const wxResp = await fetch(wxOAuthUrl, {
    method: 'GET',
    headers: {
      'User-Agent': DESKTOP_UA,
      Accept: 'text/html',
    },
    signal: AbortSignal.timeout(8_000),
  });

  const html = await wxResp.text();
  const qrMatch = html.match(/\/connect\/qrcode\/([a-zA-Z0-9]+)/);
  if (!qrMatch) {
    throw new CASProtocolError('could not extract WeChat QR UUID from OAuth page');
  }

  const uuid = qrMatch[1]!;
  return {
    uuid,
    state,
    qrImageUrl: `https://open.weixin.qq.com/connect/qrcode/${uuid}`,
    oauthUrl: wxOAuthUrl,
  };
}

export async function pollWechatQR(
  uuid: string,
  lastErrcode?: number,
): Promise<{ status: 'waiting' | 'scanned' | 'confirmed'; code?: string }> {
  const lastParam = lastErrcode !== undefined ? `&last=${lastErrcode}` : '';
  const pollUrl = `${WECHAT_POLL_BASE}?uuid=${encodeURIComponent(uuid)}${lastParam}`;

  const resp = await fetch(pollUrl, {
    method: 'GET',
    headers: {
      Referer: 'https://open.weixin.qq.com/',
      'User-Agent':
        DESKTOP_UA,
    },
    signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
  });

  const text = await resp.text();
  const errcodeMatch = text.match(/window\.wx_errcode=(\d+)/);
  const codeMatch = text.match(/window\.wx_code='([^']*)'/);

  const errcode = errcodeMatch ? parseInt(errcodeMatch[1]!, 10) : 0;
  const code = codeMatch?.[1] || '';

  if (errcode === 405 && code) {
    return { status: 'confirmed', code };
  }
  if (errcode === 404) {
    return { status: 'scanned' };
  }
  return { status: 'waiting' };
}

export async function completeWechatMFA(
  code: string,
  state: string,
): Promise<CASCredential> {
  const callbackUrl = `${casUrls.callback}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  let resp = await _fetch({
    method: 'GET',
    url: callbackUrl,
    headers: { Referer: 'https://open.weixin.qq.com/' },
    redirect: 'manual',
    timeoutMs,
  });

  // Follow the CAS redirect chain after callback.
  // The callback returns 200 HTML which auto-navigates to /authserver/login;
  // we short-circuit that and go directly to /authserver/login.
  if (resp.status === 200) {
    resp = await _fetch({
      method: 'GET',
      url: casUrls.authLogin,
      headers: { Referer: callbackUrl },
      redirect: 'manual',
      timeoutMs,
    });
  }

  // Follow redirects through the ticket-granting chain.
  for (let i = 0; i < 10; i++) {
    if (!REDIRECT_STATUSES.has(resp.status)) break;

    const location = headerSingle(resp.headers, 'location');
    if (!location) break;

    const nextUrl = new URL(location, resp.url).toString();

    // If we reach the service page with a ticket, we're done.
    if (nextUrl.includes('ticket=') && !nextUrl.includes('/authserver/login')) {
      resp = await _fetch({
        method: 'GET',
        url: nextUrl,
        redirect: 'follow',
        timeoutMs,
      });
      break;
    }

    resp = await _fetch({
      method: 'GET',
      url: nextUrl,
      redirect: 'manual',
      timeoutMs,
    });
  }

  if (await isAuthenticated()) {
    await saveCASTGC();
    return credential();
  }

  throw new CASProtocolError('WeChat MFA completed but session not established');
}

export async function authorize(
  serviceUrl: string,
  targetJar?: SimpleCookieJar,
): Promise<SimpleCookieJar> {
  const target = targetJar ?? new SimpleCookieJar();
  await (await CASCredential.fromJar(casJar)).apply(target);

  const encoded = encodeURIComponent(serviceUrl);
  const url = `${casUrls.authLogin}?service=${encoded}`;

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
      const url = `${casUrls.authLogin}?service=${encodeURIComponent(casUrls.defaultLoginService)}`;

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
    const absoluteLocation = new URL(location, casUrls.authLogin).toString();

    if (location.includes('reAuthCheck') || location.includes('isMultifactor')) {
      await _fetch({
        method: 'GET',
        url: absoluteLocation,
        headers: {
          'User-Agent':
            DESKTOP_UA,
        },
        redirect: 'manual',
        timeoutMs,
      });
      return { authenticated: false, needsMfa: true, username };
    }

    if (location.includes(casUrls.defaultLoginService) || location.includes('ticket=')) {
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

    if (follow.url.includes(casUrls.defaultLoginService) || follow.url.includes('ticket=')) {
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
