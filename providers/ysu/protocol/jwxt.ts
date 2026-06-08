/**
 * 教务系统查询模块 —— 燕山大学 EMAP 教务平台。
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
} from "@/lib/cookie";
import { authorize, getCredentialApplied } from "./cas";
import {
  serverConfig,
  jwxtUrls,
  getJwxtCookieDomain,
  getSchoolConfig,
  onSchoolConfigChanged,
} from "@/lib/server-config";

// Cached school config references for performance
let _appIds: Readonly<Record<string, string>> = getSchoolConfig().jwxt.appIds;
let _apiPaths: Readonly<Record<string, string>> = getSchoolConfig().jwxt.apiPaths;

function refreshSchoolConfigCache(): void {
  const config = getSchoolConfig();
  _appIds = config.jwxt.appIds;
  _apiPaths = config.jwxt.apiPaths;
}

// Register callback to refresh cache when school config changes
onSchoolConfigChanged(refreshSchoolConfigCache);


// ─── Types ────────────────────────────────────────────────────────────── //

export interface Course {
  readonly name: string;
  readonly code: string;
  readonly teacher: string;
  readonly classroom: string;
  readonly weekDay: number;
  readonly startSection: number;
  readonly endSection: number;
  readonly weeks: string;
  readonly weekList: number[];
  readonly credit: string;
  readonly courseType: string;
  readonly classId: string;
  readonly syxzdm: string;
  readonly scheduleId: string;
  readonly classType: string;
  readonly raw: Record<string, unknown>;
}

export interface ClassPeriod {
  readonly name: string;
  readonly section: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly isInUse: boolean;
  readonly raw: Record<string, unknown>;
}

export interface TermCalendar {
  readonly term: string;
  readonly startDate: string;
  readonly totalWeeks: number;
  readonly teachingWeeks: number;
  readonly isInUse: boolean;
  readonly raw: Record<string, unknown>;
}

export interface CurrentWeek {
  readonly week: number;
  readonly weekday: number;
  readonly term: string;
  readonly date: string;
  readonly raw: Record<string, unknown>;
}

export interface Exam {
  readonly name: string;
  readonly examName: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timeText: string;
  readonly examLocation: string;
  readonly seatNumber: string;
  readonly raw: Record<string, unknown>;
}

export interface Grade {
  readonly courseName: string;
  readonly courseCode: string;
  readonly classId: string;
  readonly score: string;
  readonly numericScore?: number;
  readonly gradeLevel: string;
  readonly gradePoint: string;
  readonly numericGradePoint?: number;
  readonly credit: string;
  readonly numericCredit?: number;
  readonly hours: string;
  readonly term: string;
  readonly courseType: string;
  readonly courseCategory: string;
  readonly examType: string;
  readonly studyMode: string;
  readonly isMajor: boolean;
  readonly isRetake: string;
  readonly gradeLevelType: string;
  readonly department: string;
  readonly isPass: boolean;
  readonly isValid: boolean;
  readonly specialReason: string;
  readonly isDegreeCourse: boolean;
  readonly projectName: string;
  readonly raw: Record<string, unknown>;
}

export interface GradeStatistics {
  readonly scope: string;
  readonly term: string;
  readonly classId: string;
  readonly courseCode: string;
  readonly highestScore: number;
  readonly lowestScore: number;
  readonly averageScore: number;
  readonly raw: Record<string, unknown>;
}

export interface GradeDistribution {
  readonly scope: string;
  readonly term: string;
  readonly classId: string;
  readonly courseCode: string;
  readonly levelCode: string;
  readonly levelName: string;
  readonly count: number;
  readonly raw: Record<string, unknown>;
}

export interface GradeRanking {
  readonly scope: string;
  readonly term: string;
  readonly studentId: string;
  readonly classId: string;
  readonly courseCode: string;
  readonly score: number;
  readonly rank: number;
  readonly total: number;
  readonly rankingType: string;
  readonly raw: Record<string, unknown>;
}

export interface GPAStats {
  readonly planName: string;
  readonly studyType: string;
  readonly requiredCreditEarned: string;
  readonly electiveCreditEarned: string;
  readonly degreeCreditEarned: string;
  readonly requiredCreditFailed: string;
  readonly gpaInitial: string;
  readonly gpaHighest: string;
  readonly requiredGpaHighest: string;
  readonly degreeGpaInitial: string;
  readonly degreeGpaHighest: string;
  readonly weightedAvg: string;
  readonly arithmeticAvg: string;
  readonly degreeWeightedAvg: string;
  readonly raw: Record<string, unknown>;
}

export interface StudentInfo {
  readonly name: string;
  readonly namePinyin: string;
  readonly studentId: string;
  readonly gender: string;
  readonly nation: string;
  readonly nationality: string;
  readonly department: string;
  readonly major: string;
  readonly className: string;
  readonly gradeLevel: string;
  readonly enrollmentDate: string;
  readonly expectedGraduation: string;
  readonly educationLevel: string;
  readonly campus: string;
  readonly studentStatus: string;
  readonly discipline: string;
  readonly studyDuration: string;
  readonly foreignLanguage: string;
  readonly raw: Record<string, unknown>;
}

export interface TrainingPlan {
  readonly courseName: string;
  readonly courseCode: string;
  readonly credit: string;
  readonly courseType: string;
  readonly required: boolean;
  readonly term: string;
  readonly courseGroup: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicWarning {
  readonly warningType: string;
  readonly warningLevel: string;
  readonly description: string;
  readonly term: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicCompletion {
  readonly planName: string;
  readonly totalRequired: string;
  readonly completed: string;
  readonly elective: string;
  readonly passed: boolean;
  readonly raw: Record<string, unknown>;
}

export interface EvaluationType {
  readonly name: string;
  readonly code: string;
  readonly count: number;
  readonly raw: Record<string, unknown>;
}

export interface EvaluationTask {
  readonly wid: string;
  readonly wjid: string;
  readonly name: string;
  readonly courseName: string;
  readonly teacherName: string;
  readonly teacherId: string;
  readonly term: string;
  readonly termName: string;
  readonly evalType: string;
  readonly evalTypeName: string;
  readonly category: string;
  readonly categoryName: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly sequence: number;
  readonly className: string;
  readonly groupNo: string;
  readonly raw: Record<string, unknown>;
}

export interface QuestionOption {
  readonly wid: string;
  readonly text: string;
  readonly score: number;
  readonly scoreRatio: number;
  readonly questionId: string;
  readonly raw: Record<string, unknown>;
}

export interface Question {
  readonly tmid: string;
  readonly wjid: string;
  readonly text: string;
  readonly questionType: string;
  readonly maxScore: number;
  readonly order: number;
  readonly options: readonly QuestionOption[];
  readonly raw: Record<string, unknown>;
}

export interface EvaluationDetail {
  readonly wjid: string;
  readonly name: string;
  readonly deadline: string;
  readonly questions: readonly Question[];
  readonly teachers: readonly Record<string, unknown>[];
  readonly raw: Record<string, unknown>;
}

export interface EvaluationAnswer {
  readonly tmid: string;
  readonly questionType: string;
  readonly optionIds: readonly string[];
  readonly text: string;
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class JWXTError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'JWXTError';
  }
}

export class NotLoggedInError extends JWXTError {
  constructor(message?: string) {
    super(message);
    this.name = 'NotLoggedInError';
  }
}

export class JWXTProtocolError extends JWXTError {
  constructor(message?: string) {
    super(message);
    this.name = 'JWXTProtocolError';
  }
}

export class JWXTBusinessError extends JWXTError {
  readonly code: string | number | null;
  readonly msg: string | null;
  readonly url: string;

  constructor(code: string | number | null, msg: string | null, url: string) {
    super(`EMAP business error from ${url}: code=${code} msg=${msg}`);
    this.name = 'JWXTBusinessError';
    this.code = code;
    this.msg = msg;
    this.url = url;
  }
}

// ─── JWXTSession ──────────────────────────────────────────────────────── //

function isJwxtCookie(e: CookieEntry): boolean {
  return (
    e.domain.length > 0 &&
    e.domain.includes(getJwxtCookieDomain()) &&
    e.name !== '_WEU'
  );
}

export class JWXTSession {
  constructor(public readonly cookies: readonly CookieEntry[]) {}

  static async fromJar(jar: SimpleCookieJar): Promise<JWXTSession> {
    return new JWXTSession(await collectCookies(jar, isJwxtCookie));
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

  static fromJSON(s: string): JWXTSession {
    const data: unknown = JSON.parse(s);
    if (data === null || typeof data !== 'object' || !('cookies' in data)) {
      throw new Error("invalid JWXTSession JSON: missing 'cookies'");
    }
    const rawCookies = (data as { cookies: unknown }).cookies;
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid JWXTSession JSON: 'cookies' must be a list");
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (item === null || typeof item !== 'object') {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`);
      }
      return cookieEntryFromJSON(item as Record<string, unknown>);
    });
    return new JWXTSession(entries);
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let jwxtJar = new SimpleCookieJar();
let timeoutMs = 30_000;
let hydrationDone: Promise<void> = Promise.resolve();

/** Per-app WEU cookie entries, keyed by appId value. */
const weuStore = new Map<string, CookieEntry>();

/** FIFO mutex to serialize WEU swap + HTTP request cycles. */
class AsyncMutex {
  private _queue: Array<() => void> = [];
  private _locked = false;

  async acquire(): Promise<void> {
    if (!this._locked) {
      this._locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      const next = this._queue.shift()!;
      next();
    } else {
      this._locked = false;
    }
  }
}

const weuMutex = new AsyncMutex();

export function getJar(): SimpleCookieJar {
  return jwxtJar;
}

export function setJar(jar: SimpleCookieJar): void {
  jwxtJar = jar;
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms;
}

export async function restoreSession(session: JWXTSession): Promise<void> {
  hydrationDone = session.apply(jwxtJar);
  await hydrationDone;
}

let cachedStudentInfo: StudentInfo | null = null;
let inflightStudentInfo: Promise<StudentInfo> | null = null;

export function resetJWXT(): void {
  jwxtJar = new SimpleCookieJar();
  hydrationDone = Promise.resolve();
  authorized = false;
  ensuredWeuApps.clear();
  inflightWeu.clear();
  weuStore.clear();
  cachedCurrentTerm = null;
  cachedStudentInfo = null;
  inflightStudentInfo = null;
  inflightCurrentTerm = null;
  cachedCurrentWeek = null;
  inflightCurrentWeek = null;
}

/** 将当前 JWXT jar 中的会话持久化到 auth-store（包含 mobile auth token）。 */
// ─── Internal helpers ─────────────────────────────────────────────────── //

const TRUTHY_TOKENS: ReadonlySet<string> = new Set(['1', '是', 'true', 'True']);

function toBool(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  return TRUTHY_TOKENS.has(String(val));
}

function buildApiUrl(path: string): string {
  return `${jwxtUrls.appBase}/${path}`;
}

function extractRows(datas: unknown, key: string): unknown[] {
  if (datas === null || typeof datas !== 'object') return [];
  const node = (datas as Record<string, unknown>)[key];
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node;
  if (typeof node === 'object') {
    const rows = (node as Record<string, unknown>)['rows'];
    return Array.isArray(rows) ? rows : [];
  }
  return [];
}

function rawStr(raw: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const k of keys) {
    const v = raw[k];
    if (v !== undefined && v !== null && v !== '' && v !== 0 && v !== false) {
      return String(v);
    }
  }
  return '';
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(value: string): string {
  return value.padStart(2, '0');
}

function normalizeDate(value: string): string {
  const match = cleanText(value).match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return '';
  return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
}

function normalizeTime(value: string): string {
  const match = cleanText(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${pad2(match[1])}:${match[2]}`;
}

function combineLocalDateTime(date: string, time: string): string {
  return date && time ? `${date}T${time}:00` : '';
}

function parseExamDateTimes(raw: Record<string, unknown>): {
  startAt: string;
  endAt: string;
  timeText: string;
} {
  const date = normalizeDate(rawStr(raw, 'KSRQ'));
  const displayText = cleanText(rawStr(raw, 'KSSJMS'));
  const displayTimes = Array.from(displayText.matchAll(/\d{1,2}:\d{2}/g), (m) => normalizeTime(m[0])).filter(Boolean);
  const startTime = normalizeTime(rawStr(raw, 'KSSJ')) || displayTimes[0] || '';
  const endTime = normalizeTime(rawStr(raw, 'JSSJ')) || displayTimes[1] || '';
  const timeText = displayText || (startTime && endTime ? `${startTime}-${endTime}` : startTime || endTime);

  return {
    startAt: combineLocalDateTime(date, startTime),
    endAt: combineLocalDateTime(date, endTime),
    timeText,
  };
}

function rawNum(raw: Record<string, unknown>, ...keys: readonly string[]): number {
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

function rawOptionalNum(raw: Record<string, unknown>, ...keys: readonly string[]): number | undefined {
  for (const k of keys) {
    const v = raw[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function rawInt(raw: Record<string, unknown>, ...keys: readonly string[]): number {
  return Math.trunc(rawNum(raw, ...keys));
}

function parseWeekList(weeksStr: string): number[] {
  const result = new Set<number>();
  if (!weeksStr) return [];
  const cleaned = weeksStr.replace(/[周第\s]/g, '');
  const parts = cleaned.split(/[,，]/);
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map((s) => parseInt(s, 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let w = start; w <= end; w++) result.add(w);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.add(n);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

const TJLX_TO_SCOPE: Readonly<Record<string, string>> = {
  '01': 'class',
  '02': 'course',
};

const COURSE_CATEGORY_TO_KBLB: Readonly<Record<string, string>> = {
  all: '0',
  theory: '1',
  experiment: '2',
};

function buildGradeStatsRequest(opts: {
  term: string;
  classId?: string;
  courseCode?: string;
}): Record<string, string> {
  const { term, classId, courseCode } = opts;
  if ((classId === undefined) === (courseCode === undefined)) {
    throw new Error('classId 与 courseCode 须仅提供其一');
  }
  if (classId !== undefined) {
    return { JXBID: classId, XNXQDM: term, TJLX: '01' };
  }
  return { JXBID: '*', KCH: String(courseCode), XNXQDM: term, TJLX: '02' };
}

async function emapPost(
  url: string,
  data: Record<string, string>,
  appId?: string,
): Promise<Record<string, unknown>> {
  const doRequest = async (): Promise<Awaited<ReturnType<typeof fetchWithJar>>> => {
    try {
      return await fetchWithJar(jwxtJar, {
        method: 'POST',
        url,
        body: new URLSearchParams(data),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        redirect: 'follow',
        timeoutMs,
      });
    } catch (e) {
      throw new JWXTProtocolError(`request failed for ${url}: ${(e as Error).message}`);
    }
  };

  let resp: Awaited<ReturnType<typeof fetchWithJar>>;

  if (appId) {
    // Swap the correct per-app _WEU into the shared jar under mutex.
    await weuMutex.acquire();
    try {
      const entry = weuStore.get(appId);
      if (entry) {
        // Remove any existing _WEU cookie(s) from the jar.
        const allCookies = await jwxtJar.getAllCookies();
        for (const c of allCookies) {
          if (c.name === '_WEU') {
            await jwxtJar.removeCookie(c.domain, c.path, '_WEU');
          }
        }
        // Install the correct per-app _WEU.
        const host = entry.domain.replace(/^\./, '') || 'localhost';
        await jwxtJar.setCookie(
          `_WEU=${entry.value}; Domain=${entry.domain}; Path=${entry.path}`,
          `https://${host}${entry.path}`,
          { ignoreError: true },
        );
      }
      resp = await doRequest();
      // Retry pjapp 404 with a known-good route cookie.
      if (resp.status === 404 && appId === _appIds.pjapp) {
        const goodRoute = getSchoolConfig().jwxt.pjappGoodRoute;
        if (goodRoute) {
          const domain = new URL(serverConfig.jwxtBaseUrl).hostname;
          await jwxtJar.setCookie(
            `route=${goodRoute}; Domain=.${domain}; Path=/`,
            serverConfig.jwxtBaseUrl,
            { ignoreError: true },
          );
          resp = await doRequest();
        }
      }
    } finally {
      weuMutex.release();
    }
  } else {
    resp = await doRequest();
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new NotLoggedInError(`HTTP ${resp.status} from ${url}`);
  }
  if (resp.status >= 400) {
    throw new JWXTProtocolError(`HTTP ${resp.status} from ${url}`);
  }

  const contentType = headerSingle(resp.headers, 'content-type') ?? '';
  const text = await resp.text();
  if (contentType.includes('text/html') && text.includes('authserver/login')) {
    throw new NotLoggedInError('session expired, redirected to CAS login page');
  }

  let result: Record<string, unknown>;
  try {
    result = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new JWXTProtocolError(`non-JSON response from ${url}: ${JSON.stringify(text.slice(0, 200))}`);
  }

  const code = result['code'];
  if (code !== '0' && code !== 0) {
    const msg = typeof result['msg'] === 'string' ? result['msg'] : null;
    const codeVal = typeof code === 'string' || typeof code === 'number' ? code : null;
    throw new JWXTBusinessError(codeVal, msg, url);
  }

  const datas = result['datas'];
  if (datas === undefined || datas === null || typeof datas !== 'object') {
    throw new JWXTProtocolError(`response missing 'datas' from ${url}`);
  }
  return datas as Record<string, unknown>;
}

let inflightAuth: Promise<unknown> | null = null;
let authorized = false;

async function ensureAuthorized(): Promise<void> {
  if (authorized) return;
  await getCredentialApplied();
  await hydrationDone;
  const cookies = await jwxtJar.getAllCookies();
  for (const c of cookies) {
    if (c.domain && c.domain.includes(getJwxtCookieDomain())) {
      authorized = true;
      return;
    }
  }
  if (inflightAuth) {
    await inflightAuth;
    return;
  }
  inflightAuth = authorize(jwxtUrls.portal, jwxtJar);
  try {
    await inflightAuth;
    authorized = true;
  } finally {
    inflightAuth = null;
  }
}

async function reauthorize(): Promise<void> {
  authorized = false;
  const all = await jwxtJar.getAllCookies();
  for (const c of all) {
    if (c.domain && c.domain.includes(getJwxtCookieDomain())) {
      await jwxtJar.removeCookie(c.domain, c.path ?? '/', c.name);
    }
  }
  await authorize(jwxtUrls.portal, jwxtJar);
  ensuredWeuApps.clear();
  weuStore.clear();
}

const ensuredWeuApps = new Set<string>();
const inflightWeu = new Map<string, Promise<void>>();

async function ensureWeu(appId: string): Promise<void> {
  if (ensuredWeuApps.has(appId)) return;
  const existing = inflightWeu.get(appId);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    const url = `${jwxtUrls.appShow}?id=${encodeURIComponent(appId)}`;
    try {
      // Use a temporary jar to avoid clobbering other apps' _WEU in the shared jar.
      const tempJar = new SimpleCookieJar();
      const sessionCookies = await collectCookies(
        jwxtJar,
        (e) => e.name !== '_WEU',
      );
      await installCookies(tempJar, sessionCookies);

      await fetchWithJar(tempJar, {
        method: 'GET',
        url,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'manual',
        timeoutMs,
      });

      // Extract _WEU from the temp jar and store it per-app.
      const tempCookies = await collectCookies(
        tempJar,
        (e) => e.name === '_WEU',
      );
      if (tempCookies.length > 0) {
        weuStore.set(appId, tempCookies[0]!);
        ensuredWeuApps.add(appId);
      }
    } catch {
      // appShow may fail; WEU will be retried on next call.
    }
  })();

  inflightWeu.set(appId, promise);
  try {
    await promise;
  } finally {
    inflightWeu.delete(appId);
  }
}

/** 并行预热常用 EMAP 应用的 WEU，避免首次 API 调用时被 appShow.do 阻塞。 */
export async function warmupWEU(): Promise<void> {
  const apps = [
    _appIds.xsjbxxgl,
    _appIds.wdkb,
    _appIds.studentWdksapApp,
    _appIds.cjcx,
    _appIds.pjapp,
  ];
  if (_appIds.wdkb_sy) apps.push(_appIds.wdkb_sy);
  await Promise.all(apps.map((id) => ensureWeu(id).catch(() => {})));
}

async function post(
  path: string,
  data: Record<string, string> = {},
  appId?: string,
): Promise<Record<string, unknown>> {
  const url = buildApiUrl(path);
  return emapPost(url, data, appId);
}

let cachedCurrentTerm: string | null = null;
let inflightCurrentTerm: Promise<string> | null = null;

let cachedCurrentWeek: { key: string; value: CurrentWeek } | null = null;
let inflightCurrentWeek: Promise<CurrentWeek> | null = null;

async function getCurrentTerm(
  appId: string,
  pathKey: string,
): Promise<string> {
  if (cachedCurrentTerm) return cachedCurrentTerm;
  if (inflightCurrentTerm) return inflightCurrentTerm;

  inflightCurrentTerm = (async () => {
    try {
      await ensureWeu(appId);
      const datas = await post(_apiPaths[pathKey]!, {}, appId);
      const segments = pathKey.split('_');
      const tail = segments[segments.length - 1]!;
      const rows = extractRows(datas, tail);
      if (rows.length === 0) {
        throw new JWXTProtocolError('current term query returned empty result');
      }
      const first = rows[0] as Record<string, unknown>;
      const raw = first['DM'];
      const term = typeof raw === 'string' ? raw : String(raw ?? '');
      if (!term) {
        throw new JWXTProtocolError('current term query returned empty DM');
      }
      cachedCurrentTerm = term;
      return term;
    } finally {
      inflightCurrentTerm = null;
    }
  })();

  return inflightCurrentTerm;
}

async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotLoggedInError) {
      await reauthorize();
      return await fn();
    }
    throw e;
  }
}

// ─── Public: Student Info ─────────────────────────────────────────────── //

export async function queryStudentInfo(): Promise<StudentInfo> {
  if (cachedStudentInfo) return cachedStudentInfo;
  if (inflightStudentInfo) return inflightStudentInfo;

  inflightStudentInfo = (async () => {
    try {
      return await runWithReauth(async () => {
        await ensureWeu(_appIds.xsjbxxgl);
        const data = {
          querySetting: '[]',
          pageSize: '12',
          pageNumber: '1',
        };
        const datas = await post(_apiPaths.xsjbxx, data, _appIds.xsjbxxgl);
        const rows = extractRows(datas, 'cxxsjbxxlb');
        if (rows.length === 0) {
          throw new JWXTProtocolError('queryStudentInfo returned empty result');
        }
        const info = parseStudentInfo(rows[0] as Record<string, unknown>);
        cachedStudentInfo = info;
        return info;
      });
    } finally {
      inflightStudentInfo = null;
    }
  })();

  return inflightStudentInfo;
}

// ─── Public: Grades ───────────────────────────────────────────────────── //

export async function queryGrades(opts?: {
  term?: string;
  courseName?: string;
  pageSize?: number;
  pageNumber?: number;
}): Promise<Grade[]> {
  const term = opts?.term;
  const courseName = opts?.courseName;
  const pageSize = opts?.pageSize ?? 999;
  const pageNumber = opts?.pageNumber ?? 1;

  return runWithReauth(async () => {
    await ensureWeu(_appIds.cjcx);

    const query: Array<Record<string, unknown>> = [];
    if (term) {
      query.push({
        name: 'XNXQDM',
        value: term,
        linkOpt: 'and',
        builder: 'm_value_equal',
      });
    }
    if (courseName) {
      query.push({
        name: 'XSKCM',
        value: courseName,
        linkOpt: 'and',
        builder: 'include',
      });
    }
    query.push(
      {
        name: 'SFYX',
        caption: '是否有效',
        linkOpt: 'AND',
        builderList: 'cbl_m_List',
        builder: 'm_value_equal',
        value: '1',
        value_display: '是',
      },
      {
        name: 'SHOWMAXCJ',
        caption: '显示最高成绩',
        linkOpt: 'AND',
        builderList: 'cbl_String',
        builder: 'equal',
        value: 0,
        value_display: '否',
      },
      {
        name: 'BY1',
        caption: '备用1',
        linkOpt: 'AND',
        builderList: 'cbl_m_List',
        builder: 'equal',
        value: '1',
      },
    );

    const data = {
      querySetting: JSON.stringify(query),
      pageSize: String(pageSize),
      pageNumber: String(pageNumber),
      '*order': '-XNXQDM,-KCH,-KXH',
    };
    const datas = await post(_apiPaths.cjcx, data, _appIds.cjcx);
    const rows = extractRows(datas, 'xscjcx');
    return rows.map((r) => parseGrade(r as Record<string, unknown>));
  });
}

export async function queryGpaStats(opts?: { studentId?: string }): Promise<GPAStats> {
  return runWithReauth(async () => {
    let studentId = opts?.studentId;
    if (studentId === undefined) {
      const info = await queryStudentInfo();
      studentId = info.studentId;
    }

    await ensureWeu(_appIds.cjcx);

    const data: Record<string, string> = {};
    for (let i = 1; i <= 6; i++) data[`XH${i}`] = studentId;

    const datas = await post(_apiPaths.cjcx_gpa, data, _appIds.cjcx);
    const rows = extractRows(datas, 'cxzxfaxfjd');
    if (rows.length === 0) {
      throw new JWXTProtocolError('queryGpaStats returned empty result');
    }
    return parseGpaStats(rows[0] as Record<string, unknown>);
  });
}

export async function queryGradeStatistics(opts?: {
  term?: string;
  classId?: string;
  courseCode?: string;
}): Promise<GradeStatistics> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.cjcx);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const payload = buildGradeStatsRequest({
      term,
      classId: opts?.classId,
      courseCode: opts?.courseCode,
    });
    const datas = await post(_apiPaths.jxbcjtjcx, payload, _appIds.cjcx);
    const rows = extractRows(datas, 'jxbcjtjcx');
    if (rows.length === 0) {
      throw new JWXTProtocolError('queryGradeStatistics returned empty result');
    }
    return parseGradeStatistics(rows[0] as Record<string, unknown>);
  });
}

export async function queryGradeDistribution(opts?: {
  term?: string;
  classId?: string;
  courseCode?: string;
}): Promise<GradeDistribution[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.cjcx);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const payload: Record<string, string> = buildGradeStatsRequest({
      term,
      classId: opts?.classId,
      courseCode: opts?.courseCode,
    });
    payload['*order'] = '+DJDM';
    const datas = await post(_apiPaths.jxbcjfbcx, payload, _appIds.cjcx);
    const rows = extractRows(datas, 'jxbcjfbcx');
    return rows.map((r) => parseGradeDistribution(r as Record<string, unknown>));
  });
}

export async function queryGradeRanking(opts?: {
  term?: string;
  studentId?: string;
  classId?: string;
  courseCode?: string;
}): Promise<GradeRanking> {
  return runWithReauth(async () => {
    let studentId = opts?.studentId;
    if (studentId === undefined) {
      const info = await queryStudentInfo();
      studentId = info.studentId;
    }

    await ensureWeu(_appIds.cjcx);

    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const payload: Record<string, string> = buildGradeStatsRequest({
      term,
      classId: opts?.classId,
      courseCode: opts?.courseCode,
    });
    payload['XH'] = studentId;
    const datas = await post(_apiPaths.jxbxspmcx, payload, _appIds.cjcx);
    const rows = extractRows(datas, 'jxbxspmcx');
    if (rows.length === 0) {
      throw new JWXTProtocolError('queryGradeRanking returned empty result');
    }
    return parseGradeRanking(rows[0] as Record<string, unknown>);
  });
}

// ─── Public: Schedule ─────────────────────────────────────────────────── //

export async function querySchedule(opts?: { term?: string }): Promise<Course[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.wdkb);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const datas = await post(_apiPaths.wdkb, { XNXQDM: term }, _appIds.wdkb);
    const rows = extractRows(datas, 'cxxszhxqkb');
    return rows.map((r) => parseCourse(r as Record<string, unknown>));
  });
}

export async function queryScheduleExperimental(opts?: {
  term?: string;
  studentId?: string;
  courseCategory?: string;
}): Promise<Course[]> {
  if (!_appIds.wdkb_sy || !_apiPaths.wdkb_sy) {
    return querySchedule({ term: opts?.term });
  }
  return queryCoursesByKblb({
    pathKey: 'wdkb_sy',
    rowKey: 'cxxskb',
    term: opts?.term,
    studentId: opts?.studentId,
    courseCategory: opts?.courseCategory ?? 'all',
  });
}

export async function queryUnscheduledCourses(opts?: {
  term?: string;
  studentId?: string;
  courseCategory?: string;
}): Promise<Course[]> {
  if (!_appIds.wdkb_sy || !_apiPaths.wdkb_sy_unscheduled) {
    return [];
  }
  return queryCoursesByKblb({
    pathKey: 'wdkb_sy_unscheduled',
    rowKey: 'cxxsllsywpk',
    term: opts?.term,
    studentId: opts?.studentId,
    courseCategory: opts?.courseCategory ?? 'all',
  });
}

async function queryCoursesByKblb(args: {
  pathKey: 'wdkb_sy' | 'wdkb_sy_unscheduled';
  rowKey: string;
  term: string | undefined;
  studentId: string | undefined;
  courseCategory: string;
}): Promise<Course[]> {
  const { pathKey, rowKey, courseCategory } = args;
  return runWithReauth(async () => {
    let term = args.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    let studentId = args.studentId;
    if (studentId === undefined) {
      const info = await queryStudentInfo();
      studentId = info.studentId;
    }

    await ensureWeu(_appIds.wdkb_sy);

    const kblb = COURSE_CATEGORY_TO_KBLB[courseCategory] ?? '0';
    const datas = await post(_apiPaths[pathKey]!, {
      XNXQDM: term,
      XH: studentId,
      KBLB: kblb,
    }, _appIds.wdkb_sy);
    const rows = extractRows(datas, rowKey);
    return rows.map((r) => parseCourse(r as Record<string, unknown>));
  });
}

export async function queryClassPeriods(): Promise<ClassPeriod[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.wdkb);
    const datas = await post(_apiPaths.jc, {}, _appIds.wdkb);
    const rows = extractRows(datas, 'jc');
    return rows.map((r) => parseClassPeriod(r as Record<string, unknown>));
  });
}

export async function queryTermCalendar(opts?: { term?: string }): Promise<TermCalendar> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.wdkb);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const { xn, xq } = splitTerm(term);
    const datas = await post(_apiPaths.cxxljc, { XN: xn, XQ: xq }, _appIds.wdkb);
    const rows = extractRows(datas, 'cxxljc');
    if (rows.length === 0) {
      throw new JWXTProtocolError('queryTermCalendar returned empty result');
    }
    return parseTermCalendar(rows[0] as Record<string, unknown>);
  });
}

export async function queryCurrentWeek(opts?: {
  term?: string;
  date?: string;
}): Promise<CurrentWeek> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.wdkb);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const date = opts?.date ?? todayDate();
    const cacheKey = `${term}|${date}`;
    if (cachedCurrentWeek?.key === cacheKey) return cachedCurrentWeek.value;
    if (inflightCurrentWeek) return inflightCurrentWeek;

    inflightCurrentWeek = (async () => {
      try {
        const { xn, xq } = splitTerm(term!);
        const datas = await post(_apiPaths.dqzc, { XN: xn, XQ: xq, RQ: date }, _appIds.wdkb);
        const rows = extractRows(datas, 'dqzc');
        if (rows.length === 0) {
          throw new JWXTProtocolError('queryCurrentWeek returned empty result');
        }
        const result = parseCurrentWeek(rows[0] as Record<string, unknown>);
        cachedCurrentWeek = { key: cacheKey, value: result };
        return result;
      } finally {
        inflightCurrentWeek = null;
      }
    })();

    return inflightCurrentWeek;
  });
}

// ─── Public: Exams ────────────────────────────────────────────────────── //

export async function queryExams(opts?: { term?: string }): Promise<Exam[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.studentWdksapApp);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const param: Record<string, unknown> = {
      XNXQDM: term,
      '*order': '-KSRQ,-KSSJMS',
    };
    const datas = await post(_apiPaths.wdksap, {
      requestParamStr: JSON.stringify(param),
    }, _appIds.studentWdksapApp);
    const rows = extractRows(datas, 'cxxsksap');
    return rows.map((r) => parseExam(r as Record<string, unknown>));
  });
}

// ─── Public: Training Plan / Academic ─────────────────────────────────── //

export async function queryTrainingPlan(opts?: {
  pageSize?: number;
  pageNumber?: number;
}): Promise<TrainingPlan[]> {
  const pageSize = opts?.pageSize ?? 999;
  const pageNumber = opts?.pageNumber ?? 1;

  return runWithReauth(async () => {
    await ensureWeu(_appIds.xsfacx);

    const firstDatas = await post(_apiPaths.pyfa, {}, _appIds.xsfacx);
    const planRows = extractRows(firstDatas, 'grpyfacx');
    if (planRows.length === 0) {
      throw new JWXTProtocolError('queryTrainingPlan: no training plan found');
    }
    const pyfadm = rawStr(planRows[0] as Record<string, unknown>, 'PYFADM');
    if (!pyfadm) {
      throw new JWXTProtocolError('queryTrainingPlan: PYFADM is empty');
    }

    const datas = await post(_apiPaths.pyfa_courses, {
      PYFADM: pyfadm,
      pageSize: String(pageSize),
      pageNumber: String(pageNumber),
    }, _appIds.xsfacx);
    const rows = extractRows(datas, 'kzkccx');
    return rows.map((r) => parseTrainingPlan(r as Record<string, unknown>));
  });
}

export async function queryAcademicCompletion(): Promise<AcademicCompletion> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.xywccx);
    const datas = await post(_apiPaths.xywc, {
      SCLBDM: '04',
      '*order': '-CZSJ',
    }, _appIds.xywccx);
    const rows = extractRows(datas, 'cxxsscfa');
    if (rows.length === 0) {
      throw new JWXTProtocolError('queryAcademicCompletion returned empty result');
    }
    return parseAcademicCompletion(rows[0] as Record<string, unknown>);
  });
}

export async function queryAcademicWarnings(): Promise<AcademicWarning[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.xyyj);
    const datas = await post(_apiPaths.xyyj, {}, _appIds.xyyj);
    const rows = extractRows(datas, 'cxxsyjpcjg');
    return rows.map((r) => parseAcademicWarning(r as Record<string, unknown>));
  });
}

// ─── Public: Evaluation ───────────────────────────────────────────────── //

export async function queryEvaluationTypes(opts?: { term?: string }): Promise<EvaluationType[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.pjapp);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const datas = await post(_apiPaths.pjlx, { XNXQDM: term }, _appIds.pjapp);
    const rows = extractRows(datas, 'getPjlx');
    return rows.map((r) => parseEvaluationType(r as Record<string, unknown>));
  });
}

export async function queryPendingEvaluations(
  evalType: string,
  opts?: { term?: string },
): Promise<EvaluationTask[]> {
  return runWithReauth(async () => {
    await ensureWeu(_appIds.pjapp);
    let term = opts?.term;
    if (term === undefined) {
      term = await getCurrentTerm(_appIds.studentWdksapApp, 'wdksap_dqxnxq');
    }
    const query = [
      {
        name: 'XNXQDM',
        builder: 'm_value_equal',
        linkOpt: 'AND',
        value: term,
      },
    ];
    const datas = await post(_apiPaths.dpwj, {
      PJLXDM: evalType,
      querySetting: JSON.stringify(query),
    }, _appIds.pjapp);
    const rows = extractRows(datas, 'getDpwj');
    return rows.map((r) => parseEvaluationTask(r as Record<string, unknown>));
  });
}

export async function getEvaluationDetail(
  groupNo: string,
  evalType: string,
  opts?: { sequence?: number },
): Promise<EvaluationDetail> {
  const sequence = opts?.sequence ?? 1;
  return runWithReauth(async () => {
    await ensureWeu(_appIds.pjapp);
    const datas = await post(_apiPaths.wjtxxx, {
      GROUPNO: groupNo,
      PJLXDM: evalType,
      XUH: String(sequence),
    }, _appIds.pjapp);
    const raw = datas['getWjtxxx'];
    if (!raw || typeof raw !== 'object') {
      throw new JWXTProtocolError('getEvaluationDetail returned empty result');
    }
    return parseEvaluationDetail(raw as Record<string, unknown>);
  });
}

export async function calculateEvaluationScore(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly EvaluationAnswer[],
  opts?: {
    teacherRelationId?: string;
    courseName?: string;
    teacherName?: string;
    sequence?: number;
  },
): Promise<Record<string, unknown>> {
  void groupNo;
  void evalType;
  const teacherRelationId = opts?.teacherRelationId ?? '';
  const courseName = opts?.courseName ?? '';
  const teacherName = opts?.teacherName ?? '';
  const sequence = opts?.sequence ?? 1;

  return runWithReauth(async () => {
    await ensureWeu(_appIds.pjapp);
    return post(
      _apiPaths.calculate_score,
      evaluationFormData({
        wjid,
        answers,
        teacherRelationId,
        courseName,
        teacherName,
        sequence,
      }),
      _appIds.pjapp,
    );
  });
}

export async function submitEvaluation(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly EvaluationAnswer[],
  opts?: {
    teacherRelationId?: string;
    courseName?: string;
    teacherName?: string;
    sequence?: number;
  },
): Promise<void> {
  void groupNo;
  void evalType;
  const teacherRelationId = opts?.teacherRelationId ?? '';
  const courseName = opts?.courseName ?? '';
  const teacherName = opts?.teacherName ?? '';
  const sequence = opts?.sequence ?? 1;

  await runWithReauth(async () => {
    await ensureWeu(_appIds.pjapp);
    await post(
      _apiPaths.commit_answer,
      evaluationFormData({
        wjid,
        answers,
        teacherRelationId,
        courseName,
        teacherName,
        sequence,
      }),
      _appIds.pjapp,
    );
  });
}

// ─── Parsers ──────────────────────────────────────────────────────────── //

function parseGrade(raw: Record<string, unknown>): Grade {
  const zcj = raw['ZCJ'];
  const score =
    zcj !== undefined && zcj !== null ? String(zcj) : rawStr(raw, 'XSZCJMC');

  return {
    courseName: rawStr(raw, 'XSKCM', 'KCM'),
    courseCode: rawStr(raw, 'XSKCH', 'KCH'),
    classId: rawStr(raw, 'JXBID'),
    score,
    numericScore: rawOptionalNum(raw, 'ZCJ'),
    gradeLevel: rawStr(raw, 'XSZCJMC'),
    gradePoint: rawStr(raw, 'XFJD'),
    numericGradePoint: rawOptionalNum(raw, 'XFJD'),
    credit: rawStr(raw, 'XF'),
    numericCredit: rawOptionalNum(raw, 'XF'),
    hours: rawStr(raw, 'XS'),
    term: rawStr(raw, 'XNXQDM'),
    courseType: rawStr(raw, 'KCXZDM_DISPLAY', 'KCXZDM'),
    courseCategory: rawStr(raw, 'KCLBDM_DISPLAY'),
    examType: rawStr(raw, 'KSLXDM_DISPLAY', 'KSLXDM'),
    studyMode: rawStr(raw, 'XDFSDM_DISPLAY'),
    isMajor: toBool(raw['SFZX']),
    isRetake: rawStr(raw, 'CXCKDM_DISPLAY'),
    gradeLevelType: rawStr(raw, 'XSDJCJLXDM_DISPLAY'),
    department: rawStr(raw, 'KKDWDM_DISPLAY'),
    isPass: toBool(raw['SFJG']),
    isValid: toBool(raw['SFYX']),
    specialReason: rawStr(raw, 'TSYYDM_DISPLAY'),
    isDegreeCourse: toBool(raw['SFZGKC']),
    projectName: rawStr(raw, 'TYXMDM_DISPLAY'),
    raw,
  };
}

function parseGpaStats(raw: Record<string, unknown>): GPAStats {
  return {
    planName: rawStr(raw, 'PYFAMC'),
    studyType: rawStr(raw, 'FAXDLX_DISPLAY'),
    requiredCreditEarned: rawStr(raw, 'BXKHDXF'),
    electiveCreditEarned: rawStr(raw, 'XXKHDXF'),
    degreeCreditEarned: rawStr(raw, 'XWKHDXF'),
    requiredCreditFailed: rawStr(raw, 'BXKBJGXF'),
    gpaInitial: rawStr(raw, 'PPJDCX'),
    gpaHighest: rawStr(raw, 'PPJDZG'),
    requiredGpaHighest: rawStr(raw, 'BXKPPJD'),
    degreeGpaInitial: rawStr(raw, 'XWKPJJDCX'),
    degreeGpaHighest: rawStr(raw, 'XWKPJJDZG'),
    weightedAvg: rawStr(raw, 'JQPJF'),
    arithmeticAvg: rawStr(raw, 'SSPJF'),
    degreeWeightedAvg: rawStr(raw, 'XWKJQPJF'),
    raw,
  };
}

function parseGradeStatistics(raw: Record<string, unknown>): GradeStatistics {
  return {
    scope: TJLX_TO_SCOPE[String(raw['TJLX'] ?? '')] ?? '',
    term: rawStr(raw, 'XNXQDM'),
    classId: rawStr(raw, 'JXBID'),
    courseCode: rawStr(raw, 'KCH'),
    highestScore: rawNum(raw, 'ZGF'),
    lowestScore: rawNum(raw, 'ZDF'),
    averageScore: rawNum(raw, 'PJF'),
    raw,
  };
}

function parseGradeDistribution(raw: Record<string, unknown>): GradeDistribution {
  return {
    scope: TJLX_TO_SCOPE[String(raw['TJLX'] ?? '')] ?? '',
    term: rawStr(raw, 'XNXQDM'),
    classId: rawStr(raw, 'JXBID'),
    courseCode: rawStr(raw, 'KCH'),
    levelCode: rawStr(raw, 'DJDM'),
    levelName: rawStr(raw, 'DJDM_DISPLAY'),
    count: rawInt(raw, 'DJSL'),
    raw,
  };
}

function parseGradeRanking(raw: Record<string, unknown>): GradeRanking {
  return {
    scope: TJLX_TO_SCOPE[String(raw['TJLX'] ?? '')] ?? '',
    term: rawStr(raw, 'XNXQDM'),
    studentId: rawStr(raw, 'XH'),
    classId: rawStr(raw, 'JXBID'),
    courseCode: rawStr(raw, 'KCH'),
    score: rawNum(raw, 'PMF'),
    rank: rawInt(raw, 'PM'),
    total: rawInt(raw, 'ZRS'),
    rankingType: rawStr(raw, 'PMLX'),
    raw,
  };
}

function parseStudentInfo(raw: Record<string, unknown>): StudentInfo {
  return {
    name: rawStr(raw, 'XM'),
    namePinyin: rawStr(raw, 'XMPY'),
    studentId: rawStr(raw, 'XH'),
    gender: rawStr(raw, 'XBDM_DISPLAY'),
    nation: rawStr(raw, 'MZDM_DISPLAY'),
    nationality: rawStr(raw, 'GJDQDM_DISPLAY'),
    department: rawStr(raw, 'YXDM_DISPLAY'),
    major: rawStr(raw, 'ZYDM_DISPLAY', 'RXZY_DISPLAY'),
    className: rawStr(raw, 'BJMC', 'RXBJ_DISPLAY'),
    gradeLevel: rawStr(raw, 'XZNJ_DISPLAY'),
    enrollmentDate: rawStr(raw, 'RXNY'),
    expectedGraduation: rawStr(raw, 'YJBYRQ'),
    educationLevel: rawStr(raw, 'PYCCDM_DISPLAY'),
    campus: rawStr(raw, 'XXXQDM_DISPLAY'),
    studentStatus: rawStr(raw, 'XJZTDM_DISPLAY'),
    discipline: rawStr(raw, 'XKMLDM_DISPLAY'),
    studyDuration: rawStr(raw, 'XZ'),
    foreignLanguage: rawStr(raw, 'WYYZDM_DISPLAY'),
    raw,
  };
}

function splitTerm(term: string): { xn: string; xq: string } {
  const idx = term.lastIndexOf('-');
  if (idx < 0) return { xn: term, xq: '' };
  return { xn: term.slice(0, idx), xq: term.slice(idx + 1) };
}

function todayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function combineTerm(raw: Record<string, unknown>): string {
  const xn = rawStr(raw, 'XN');
  const xq = rawStr(raw, 'XQ');
  if (xn && xq) return `${xn}-${xq}`;
  return xn || xq;
}

function parseCourse(raw: Record<string, unknown>): Course {
  const weeks = rawStr(raw, 'ZCMC');
  return {
    name: rawStr(raw, 'KCM'),
    code: rawStr(raw, 'KCH'),
    teacher: rawStr(raw, 'SKJS', 'JSMC'),
    classroom: rawStr(raw, 'JASMC'),
    weekDay: rawInt(raw, 'SKXQ', 'XQ'),
    startSection: rawInt(raw, 'KSJC'),
    endSection: rawInt(raw, 'JSJC'),
    weeks,
    weekList: parseWeekList(weeks),
    credit: rawStr(raw, 'XF'),
    courseType: rawStr(raw, 'KCXZDM'),
    classId: rawStr(raw, 'JXBID'),
    syxzdm: rawStr(raw, 'SYXZDM'),
    scheduleId: rawStr(raw, 'KBID'),
    classType: rawStr(raw, 'JXBLX') || '1',
    raw,
  };
}

function parseClassPeriod(raw: Record<string, unknown>): ClassPeriod {
  return {
    name: rawStr(raw, 'MC'),
    section: rawInt(raw, 'DM', 'PX'),
    startTime: rawStr(raw, 'KSSJ'),
    endTime: rawStr(raw, 'JSSJ'),
    isInUse: toBool(raw['SFSY']),
    raw,
  };
}

function parseTermCalendar(raw: Record<string, unknown>): TermCalendar {
  const start = rawStr(raw, 'XQKSRQ');
  return {
    term: combineTerm(raw),
    startDate: start ? (start.split(' ')[0] ?? '') : '',
    totalWeeks: rawInt(raw, 'ZZC'),
    teachingWeeks: rawInt(raw, 'ZJXZC'),
    isInUse: toBool(raw['SFSY']),
    raw,
  };
}

function parseCurrentWeek(raw: Record<string, unknown>): CurrentWeek {
  const rq = rawStr(raw, 'RQ');
  return {
    week: rawInt(raw, 'ZC'),
    weekday: rawInt(raw, 'XQJ'),
    term: combineTerm(raw),
    date: rq ? (rq.split(' ')[0] ?? '') : '',
    raw,
  };
}

function parseExam(raw: Record<string, unknown>): Exam {
  const { startAt, endAt, timeText } = parseExamDateTimes(raw);
  return {
    name: rawStr(raw, 'KCM'),
    examName: rawStr(raw, 'KSMC'),
    startAt,
    endAt,
    timeText,
    examLocation: rawStr(raw, 'JASMC'),
    seatNumber: rawStr(raw, 'ZWH'),
    raw,
  };
}

const TRAINING_REQUIRED_TOKENS: ReadonlySet<string> = new Set([
  '01',
  '1',
  '必修',
]);

function parseTrainingPlan(raw: Record<string, unknown>): TrainingPlan {
  const kcxzdm = rawStr(raw, 'KCXZDM');
  return {
    courseName: rawStr(raw, 'KCM'),
    courseCode: rawStr(raw, 'KCH'),
    credit: rawStr(raw, 'XF'),
    courseType: rawStr(raw, 'KCXZDM'),
    required: TRAINING_REQUIRED_TOKENS.has(kcxzdm),
    term: rawStr(raw, 'XNXQ', 'JHXNXQ'),
    courseGroup: rawStr(raw, 'KZM'),
    raw,
  };
}

function parseAcademicCompletion(raw: Record<string, unknown>): AcademicCompletion {
  return {
    planName: rawStr(raw, 'PYFAMC'),
    totalRequired: rawStr(raw, 'YQXF'),
    completed: rawStr(raw, 'WCXF'),
    elective: rawStr(raw, 'XKXF'),
    passed: toBool(raw['JSSFTG']),
    raw,
  };
}

function parseAcademicWarning(raw: Record<string, unknown>): AcademicWarning {
  return {
    warningType: rawStr(raw, 'SCJLMC'),
    warningLevel: rawStr(raw, 'YJJB'),
    description: rawStr(raw, 'BZ'),
    term: rawStr(raw, 'SCPCMC'),
    raw,
  };
}

function parseEvaluationType(raw: Record<string, unknown>): EvaluationType {
  return {
    name: rawStr(raw, 'PJLXMC'),
    code: rawStr(raw, 'PJLXDM'),
    count: rawInt(raw, 'NUMBER'),
    raw,
  };
}

function parseEvaluationTask(raw: Record<string, unknown>): EvaluationTask {
  const seq = raw['XUH'];
  const sequence =
    seq === undefined || seq === null || seq === '' || seq === 0
      ? 1
      : rawInt(raw, 'XUH');
  return {
    wid: rawStr(raw, 'WID'),
    wjid: rawStr(raw, 'WJID'),
    name: rawStr(raw, 'MC'),
    courseName: rawStr(raw, 'KCM'),
    teacherName: rawStr(raw, 'XM', 'SKDX'),
    teacherId: rawStr(raw, 'JSH'),
    term: rawStr(raw, 'XNXQDM'),
    termName: rawStr(raw, 'XNXQMC'),
    evalType: rawStr(raw, 'PJLXDM'),
    evalTypeName: rawStr(raw, 'PJLXMC'),
    category: rawStr(raw, 'PJLBDM'),
    categoryName: rawStr(raw, 'PJLBMC'),
    startTime: rawStr(raw, 'KSSJ'),
    endTime: rawStr(raw, 'JSSJ'),
    sequence,
    className: rawStr(raw, 'BJMC'),
    groupNo: rawStr(raw, 'GROUPNO'),
    raw,
  };
}

function parseQuestionOption(raw: Record<string, unknown>): QuestionOption {
  return {
    wid: rawStr(raw, 'WID'),
    text: rawStr(raw, 'MC'),
    score: rawNum(raw, 'FZ'),
    scoreRatio: rawNum(raw, 'FZBL'),
    questionId: rawStr(raw, 'TMID'),
    raw,
  };
}

function parseQuestion(raw: Record<string, unknown>): Question {
  const optionsRaw = Array.isArray(raw['questionOptions'])
    ? (raw['questionOptions'] as unknown[])
    : [];
  const options = optionsRaw.map((o) => parseQuestionOption(o as Record<string, unknown>));
  options.sort((a, b) => rawInt(a.raw, 'PX') - rawInt(b.raw, 'PX'));
  return {
    tmid: rawStr(raw, 'TMID'),
    wjid: rawStr(raw, 'WJID'),
    text: rawStr(raw, 'MC'),
    questionType: rawStr(raw, 'TX'),
    maxScore: rawNum(raw, 'ZF'),
    order: rawInt(raw, 'PX'),
    options,
    raw,
  };
}

function parseEvaluationDetail(raw: Record<string, unknown>): EvaluationDetail {
  const qList = Array.isArray(raw['questionList'])
    ? (raw['questionList'] as unknown[])
    : [];
  const questions = qList.map((q) => parseQuestion(q as Record<string, unknown>));
  questions.sort((a, b) => {
    const pa = rawInt(a.raw, 'PX');
    const pb = rawInt(b.raw, 'PX');
    if (pa !== pb) return pa - pb;
    return a.tmid < b.tmid ? -1 : a.tmid > b.tmid ? 1 : 0;
  });
  const teachersRaw = Array.isArray(raw['teachers'])
    ? (raw['teachers'] as unknown[])
    : [];
  return {
    wjid: rawStr(raw, 'WJID'),
    name: rawStr(raw, 'WJMC'),
    deadline: rawStr(raw, 'JZRQ'),
    questions,
    teachers: teachersRaw.map((t) => t as Record<string, unknown>),
    raw,
  };
}

const EVALUATION_FJTXXX_STUB = {
  SKRS: null,
  TKFJ: null,
  TKYJ: null,
  TKSJ: null,
  SJSKJS: null,
  SDXSS: null,
  CDZTS: null,
  TKNR: null,
  TKZC: '10',
  TKXQ: '0',
  TKKSJC: '1',
  TKJSJC: '1',
  WID: null,
} as const;

function buildAnswerPayload(
  answer: EvaluationAnswer,
  wjid: string,
): Record<string, unknown> {
  if (answer.questionType === '02' || answer.text) {
    return {
      WJID: wjid,
      TMID: answer.tmid,
      TX: answer.questionType || '02',
      DA: answer.text,
    };
  }
  if (answer.optionIds.length === 1) {
    return {
      WJID: wjid,
      TMID: answer.tmid,
      TX: answer.questionType || '01',
      DA: { TMXXID: answer.optionIds[0], FJXX: '' },
    };
  }
  return {
    WJID: wjid,
    TMID: answer.tmid,
    TX: answer.questionType || '07',
    DA: answer.optionIds.map((oid) => ({ TMXXID: oid, FJXX: '' })),
  };
}

function evaluationFormData(args: {
  wjid: string;
  answers: readonly EvaluationAnswer[];
  teacherRelationId: string;
  courseName: string;
  teacherName: string;
  sequence: number;
}): Record<string, string> {
  const { wjid, answers, teacherRelationId, courseName, teacherName, sequence } =
    args;
  const daList = answers.map((a) => buildAnswerPayload(a, wjid));
  const payload: Record<string, unknown> = {
    DF: null,
    PJZT: '0',
    DA: daList,
    PJGXID: teacherRelationId,
    KCM: courseName,
    XM: teacherName,
    XUH: sequence,
    FJTXXX: { ...EVALUATION_FJTXXX_STUB },
    WJID: wjid,
    questionAnswers: JSON.stringify(daList),
  };
  return { requestParamStr: JSON.stringify([payload]) };
}

