/**
 * jwmobile API 模块 —— 独立 mobile biz 接口。
 *
 * 拥有独立的 SimpleCookieJar，不依赖 JWXT EMAP 的 session。
 */
import {
  SimpleCookieJar,
  CookieEntry,
  collectCookies,
  installCookies,
  cookieEntryFromJSON,
  fetchWithJar,
  headerSingle,
} from './cookie';
import { authorize } from './cas';
import { useAuthStore } from './auth-store';

// ─── Constants ────────────────────────────────────────────────────────── //

const JWXT_BASE_URL = 'https://jwxt.ysu.edu.cn';
const MOBILE_API_BASE = `${JWXT_BASE_URL}/jwmobile/biz/v410`;
const MOBILE_AUTH_URL = `${JWXT_BASE_URL}/jwmobile/auth/index`;
const MOBILE_COOKIE_DOMAIN = 'jwxt.ysu.edu.cn';
const DEFAULT_TIMEOUT_MS = 30_000;
const MOBILE_REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

// ─── Types ────────────────────────────────────────────────────────────── //

export interface LessonActivity {
  readonly activityId: string;
  readonly type: number | null;
  readonly status: number | null;
  readonly title: string | null;
  readonly icon: string | null;
  readonly signType: string | null;
  readonly signClazz: string | null;
  readonly isEnd: boolean;
  readonly isCreator: boolean;
  readonly createTime: string | null;
  readonly raw: Record<string, unknown>;
}

export interface CurrentLesson {
  readonly lessonId: string | null;
  readonly activityList: readonly LessonActivity[];
  readonly raw: Record<string, unknown>;
}

export interface SigninActivityDetail {
  readonly activityId: string;
  readonly duration: number;
  readonly endTime: string;
  readonly leftSeconds: number;
  readonly signinType: number;
  readonly startTime: string;
  readonly raw: Record<string, unknown>;
}

export interface StudentSigninStatus {
  readonly signStatus: number;
  readonly attendanceStatus: number;
  readonly signOrder: number;
  readonly signinType: number;
  readonly raw: Record<string, unknown>;
}

export interface StudentSignResult {
  readonly signStatus: number;
  readonly attendanceStatus: number;
  readonly signOrder: number;
  readonly signinType: number;
  readonly raw: Record<string, unknown>;
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class MobileError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'MobileError';
  }
}

export class MobileNotLoggedInError extends MobileError {
  constructor(message?: string) {
    super(message);
    this.name = 'MobileNotLoggedInError';
  }
}

export class MobileProtocolError extends MobileError {
  constructor(message?: string) {
    super(message);
    this.name = 'MobileProtocolError';
  }
}

export class MobileBusinessError extends MobileError {
  readonly code: string | number | null;
  readonly msg: string | null;
  readonly url: string;

  constructor(code: string | number | null, msg: string | null, url: string) {
    super(`Mobile business error from ${url}: code=${code} msg=${msg}`);
    this.name = 'MobileBusinessError';
    this.code = code;
    this.msg = msg;
    this.url = url;
  }
}

// ─── MobileSession ────────────────────────────────────────────────────── //

function isMobileCookie(e: CookieEntry): boolean {
  return e.domain.length > 0 && e.domain.includes(MOBILE_COOKIE_DOMAIN);
}

export class MobileSession {
  constructor(public readonly cookies: readonly CookieEntry[]) {}

  static async fromJar(jar: SimpleCookieJar): Promise<MobileSession> {
    return new MobileSession(await collectCookies(jar, isMobileCookie));
  }

  async apply(jar: SimpleCookieJar): Promise<void> {
    await installCookies(jar, this.cookies);
  }

  isEmpty(): boolean {
    return this.cookies.length === 0;
  }

  toJSON(): string {
    return JSON.stringify({ cookies: this.cookies.map((c) => ({ ...c })) });
  }

  static fromJSON(s: string): MobileSession {
    const data: unknown = JSON.parse(s);
    if (
      data === null ||
      typeof data !== 'object' ||
      !('cookies' in data)
    ) {
      throw new Error("invalid MobileSession JSON: missing 'cookies'");
    }
    const rawCookies = (data as { cookies: unknown }).cookies;
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid MobileSession JSON: 'cookies' must be a list");
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (item === null || typeof item !== 'object') {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`);
      }
      return cookieEntryFromJSON(item as Record<string, unknown>);
    });
    return new MobileSession(entries);
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let mobileJar = new SimpleCookieJar();
let timeoutMs = DEFAULT_TIMEOUT_MS;
let hydrationDone: Promise<void> = Promise.resolve();
let mobileAuthorized = false;
let inflightMobileAuth: Promise<unknown> | null = null;

export function getJar(): SimpleCookieJar {
  return mobileJar;
}

export function setJar(jar: SimpleCookieJar): void {
  mobileJar = jar;
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms;
}

export async function restoreSession(session: MobileSession): Promise<void> {
  hydrationDone = session.apply(mobileJar);
  await hydrationDone;
}

export function resetMobileAuth(): void {
  mobileJar = new SimpleCookieJar();
  hydrationDone = Promise.resolve();
  mobileAuthorized = false;
  inflightMobileAuth = null;
}

// ─── Internal helpers ─────────────────────────────────────────────────── //

async function captureMobileToken(): Promise<string | null> {
  let url = MOBILE_AUTH_URL;
  let redirects = 0;
  const maxRedirects = 5;

  while (redirects < maxRedirects) {
    const resp = await fetchWithJar(mobileJar, {
      method: 'GET',
      url,
      redirect: 'manual',
      timeoutMs,
    });

    const location = headerSingle(resp.headers, 'location') ?? '';
    if (location) {
      const tokenMatch = location.match(/[?&]token=([^&#]+)/);
      if (tokenMatch) {
        return decodeURIComponent(tokenMatch[1]!);
      }

      if (MOBILE_REDIRECT_STATUSES.has(resp.status)) {
        url = new URL(location, url).toString();
        redirects++;
        continue;
      }
    }

    break;
  }

  return null;
}

async function verifyMobileToken(): Promise<boolean> {
  try {
    const resp = await fetchWithJar(mobileJar, {
      method: 'GET',
      url: `${MOBILE_API_BASE}/`,
      redirect: 'follow',
      timeoutMs,
    });
    // 已认证时返回 404；未认证时返回 200 但 body 中 code: 401
    if (resp.status === 404) return true;
    const text = await resp.text();
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const code = data['code'];
      if (code === 401 || code === '401') return false;
    } catch {
      // non-JSON 响应，保守视为有效
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureMobileAuthorized(verify = false): Promise<void> {
  if (mobileAuthorized) return;

  const cookies = await mobileJar.getAllCookies();
  const hasAuthCookie = cookies.some(
    (c) =>
      c.name === 'Authorization' &&
      c.value &&
      c.domain.includes(MOBILE_COOKIE_DOMAIN),
  );
  if (hasAuthCookie) {
    if (verify) {
      const valid = await verifyMobileToken();
      if (valid) {
        mobileAuthorized = true;
        return;
      }
      // Token 已过期，清除过期的 cookie 继续重新获取
      await mobileJar.removeCookie(MOBILE_COOKIE_DOMAIN, '/jwmobile', 'Authorization');
    } else {
      mobileAuthorized = true;
      return;
    }
  }

  if (inflightMobileAuth) {
    await inflightMobileAuth;
    return;
  }

  inflightMobileAuth = (async () => {
    // Step 1: Complete CAS SSO to obtain JSESSIONID.
    await authorize(MOBILE_AUTH_URL, mobileJar);

    // Step 2: Capture JWT token from the redirect chain.
    const token = await captureMobileToken();
    if (!token) {
      throw new MobileProtocolError('Failed to obtain mobile JWT token');
    }

    // Step 3: Store token as Authorization cookie for jwmobile API calls.
    await mobileJar.setCookie(
      `Authorization=${token}; Path=/jwmobile; Domain=jwxt.ysu.edu.cn; Secure`,
      `${JWXT_BASE_URL}/jwmobile/`,
    );
  })();

  try {
    await inflightMobileAuth;
    mobileAuthorized = true;
    persistSession().catch(() => {
      /* ignore persist failures */
    });
  } finally {
    inflightMobileAuth = null;
  }
}

async function persistSession(): Promise<void> {
  const session = await MobileSession.fromJar(mobileJar);
  if (!session.isEmpty()) {
    useAuthStore.getState().setMobileSession(session.toJSON());
  }
}

// ─── Request helpers ──────────────────────────────────────────────────── //

async function mobileRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  await ensureMobileAuthorized();

  const url = `${MOBILE_API_BASE}/${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const resp = await fetchWithJar(mobileJar, {
    method,
    url,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'follow',
    timeoutMs,
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new MobileNotLoggedInError(`HTTP ${resp.status} from ${url}`);
  }
  if (resp.status >= 400) {
    throw new MobileProtocolError(`HTTP ${resp.status} from ${url}`);
  }

  const text = await resp.text();
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new MobileProtocolError(
      `non-JSON response from ${url}: ${JSON.stringify(text.slice(0, 200))}`,
    );
  }

  const code = result['code'];
  if (code !== 200 && code !== '200' && code !== 0 && code !== '0') {
    const msg =
      typeof result['msg'] === 'string' ? result['msg'] : null;
    if (code === 401 || code === '401') {
      throw new MobileNotLoggedInError(
        msg || `Mobile API authentication failed: ${url}`,
      );
    }
    const codeVal =
      typeof code === 'string' || typeof code === 'number' ? code : null;
    throw new MobileBusinessError(codeVal, msg, url);
  }

  const data = result['data'];
  let returnData: Record<string, unknown>;
  if (data === undefined || data === null) {
    returnData = {};
  } else if (typeof data !== 'object') {
    returnData = { _value: data };
  } else {
    returnData = data as Record<string, unknown>;
  }

  persistSession().catch(() => {
    /* ignore persist failures */
  });
  return returnData;
}

async function mobilePost(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return mobileRequest('POST', path, body);
}

// ─── Auth wrapper ─────────────────────────────────────────────────────── //

async function withMobileReauth<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MobileNotLoggedInError) {
      resetMobileAuth();
      return await fn();
    }
    throw e;
  }
}

// ─── Public API ───────────────────────────────────────────────────────── //

export async function queryCurrentLesson(params: {
  teachClassId: string;
  teachClassType: string;
  scheduleId: string;
  week: number;
  weekDay: number;
  startNode: number;
  endNode: number;
}): Promise<CurrentLesson> {
  return withMobileReauth(async () => {
    const data = await mobilePost('lesson/queryCurrentLesson', {
      teachClassId: params.teachClassId,
      teachClassType: params.teachClassType,
      scheduleId: params.scheduleId,
      week: params.week,
      weekDay: params.weekDay,
      startNode: params.startNode,
      endNode: params.endNode,
    });
    return parseCurrentLesson(data);
  });
}

export async function querySigninDetail(params: {
  activityId: string;
  title?: string;
}): Promise<SigninActivityDetail> {
  return withMobileReauth(async () => {
    const data = await mobilePost('signin/detail', {
      activityId: params.activityId,
      title: params.title ?? '签到',
    });
    return parseSigninActivityDetail(data);
  });
}

export async function queryStudentSigninStatus(params: {
  activityId: string;
  title?: string;
}): Promise<StudentSigninStatus> {
  return withMobileReauth(async () => {
    const data = await mobilePost('signin/querySigninDetail', {
      activityId: params.activityId,
      title: params.title ?? '签到',
    });
    return parseStudentSigninStatus(data);
  });
}

export async function studentSign(params: {
  activityId: string;
  accuracy?: number;
  latitude?: number;
  longitude?: number;
  code?: string;
}): Promise<StudentSignResult> {
  return withMobileReauth(async () => {
    const body: Record<string, unknown> = {
      activityId: params.activityId,
      accuracy: params.accuracy ?? 0,
      latitude: params.latitude ?? 0,
      longitude: params.longitude ?? 0,
    };
    if (params.code) {
      body.code = params.code;
    }
    const data = await mobilePost('signin/sign', body);
    return parseStudentSignResult(data);
  });
}

// ─── Parsers ──────────────────────────────────────────────────────────── //

function rawStr(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): string {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '' && v !== 0 && v !== false) {
      return String(v);
    }
  }
  return '';
}

function rawNum(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): number {
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function rawInt(
  raw: Record<string, unknown>,
  ...keys: readonly string[]
): number {
  return Math.trunc(rawNum(raw, ...keys));
}

function parseCurrentLesson(raw: Record<string, unknown>): CurrentLesson {
  const list = Array.isArray(raw['activityList'])
    ? (raw['activityList'] as unknown[])
    : [];
  return {
    lessonId: raw['lessonId'] != null ? String(raw['lessonId']) : null,
    activityList: list.map((a) =>
      parseLessonActivity(a as Record<string, unknown>),
    ),
    raw,
  };
}

function parseLessonActivity(
  raw: Record<string, unknown>,
): LessonActivity {
  const typeRaw = raw['type'];
  const statusRaw = raw['status'];
  const titleRaw = raw['title'];
  const iconRaw = raw['icon'];
  return {
    activityId: rawStr(raw, 'activityId'),
    type: typeRaw == null ? null : rawInt(raw, 'type'),
    status: statusRaw == null ? null : rawInt(raw, 'status'),
    title: titleRaw == null ? null : rawStr(raw, 'title'),
    icon: iconRaw == null ? null : rawStr(raw, 'icon'),
    signType: rawStr(raw, 'signType'),
    signClazz: rawStr(raw, 'signClazz'),
    isEnd: Boolean(raw['isEnd']),
    isCreator: Boolean(raw['isCreator']),
    createTime: raw['createTime'] == null ? null : rawStr(raw, 'createTime'),
    raw,
  };
}

function parseSigninActivityDetail(
  raw: Record<string, unknown>,
): SigninActivityDetail {
  return {
    activityId: rawStr(raw, 'activityId'),
    duration: rawInt(raw, 'duration'),
    endTime: rawStr(raw, 'endTime'),
    leftSeconds: rawInt(raw, 'leftSeconds'),
    signinType: rawInt(raw, 'signinType'),
    startTime: rawStr(raw, 'startTime'),
    raw,
  };
}

function parseStudentSigninStatus(
  raw: Record<string, unknown>,
): StudentSigninStatus {
  return {
    signStatus: rawInt(raw, 'signStatus'),
    attendanceStatus: rawInt(raw, 'attendanceStatus'),
    signOrder: rawInt(raw, 'signOrder'),
    signinType: rawInt(raw, 'signinType'),
    raw,
  };
}

function parseStudentSignResult(
  raw: Record<string, unknown>,
): StudentSignResult {
  return {
    signStatus: rawInt(raw, 'signStatus'),
    attendanceStatus: rawInt(raw, 'attendanceStatus'),
    signOrder: rawInt(raw, 'signOrder'),
    signinType: rawInt(raw, 'signinType'),
    raw,
  };
}
