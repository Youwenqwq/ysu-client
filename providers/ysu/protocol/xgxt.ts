/**
 * 学工系统（综合测评）—— 只读查询模块。
 *
 * 移植自 ysu-sdk 的 xgxt 子包。与 jwxt 同属 EMAP 系（cookie 会话 +
 * code envelope），但角色上下文经显式握手绑定（getAppConfig →
 * setXgCommonAppRole → changeAppRole），相当于 jwxt _WEU 门槛的同构物。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import {
  SimpleCookieJar,
  fetchWithJar,
  headerSingle,
  type HttpResponse,
} from "@/lib/cookie";
import { authorize, getCredentialApplied } from "./cas";
import { getSchoolConfig } from "@/lib/server-config";

// ─── Constants ────────────────────────────────────────────────────────── //

/** 综合测评应用标识。 */
const APP_NAME = 'zhcptybbapp';
/** EMAP 数字应用 ID（getAppConfig 的 appId 参数）。 */
const EMAP_APP_ID = '5275772372599202';

/** 业务 API 路径（相对应用 base）。 */
const API_PATHS = {
  /** 可查询的测评学年学期列表。 */
  cpxnxq: 'modules/evaluationApplyController/getCpxnxq.do',
  /** 指定学年学期的综测成绩与排名。 */
  cjByXn: 'modules/evaluationApplyController/getEvaluationResultsByXn.do',
  /** 各学年学期综测分数总览（我和自己比一比）。 */
  yearCjStatic: 'modules/evaluationApplyController/getYearCjStatic.do',
  /** 指标雷达对比（我和别人比一比）。 */
  redar: 'modules/evaluationApplyController/getRedar.do',
  /** 指标得分明细分页。 */
  zbxx: 'modules/zccj/tjsqhqxqzbxx.do',
  /** 学业成绩报告可选学年。 */
  fiveYears: 'modules/evaluationBjhpController/getFiveYears.do',
  /** 学业成绩报告默认学年。 */
  mrXn: 'modules/evaluationBjhpController/getMrXn.do',
  /** 学业成绩报告分页列表。 */
  xycjbg: 'modules/public/xycjbg.do',
} as const;

// ─── Types ────────────────────────────────────────────────────────────── //

export interface EvaluationTerm {
  /** 测评学年代码（CPXN，如 "2025" 表示 2025-2026 学年）。 */
  readonly year: string;
  /** 测评学期代码（CPXQ，"1"/"2"）。 */
  readonly term: string;
  readonly yearDisplay: string;
  readonly termDisplay: string;
  readonly wid: string;
  readonly raw: Record<string, unknown>;
}

export interface EvaluationIndicator {
  readonly name: string;
  readonly score: string;
  readonly rank: number;
  readonly maxScore: string;
  readonly category: string;
  readonly description: string;
  readonly raw: Record<string, unknown>;
}

export interface EvaluationResult {
  readonly totalScore: string;
  readonly classRank: number;
  readonly classSize: number;
  readonly gradeRank: number;
  readonly gradeSize: number;
  readonly year: string;
  readonly term: string;
  readonly yearDisplay: string;
  readonly termDisplay: string;
  readonly showMajorRank: boolean;
  readonly indicators: EvaluationIndicator[];
  readonly raw: Record<string, unknown>;
}

export interface EvaluationIndicatorDetail {
  readonly name: string;
  readonly score: string;
  readonly maxScore: string;
  readonly rangeText: string;
  readonly proportion: string;
  readonly categoryDisplay: string;
  readonly description: string;
  readonly raw: Record<string, unknown>;
}

export interface EvaluationRadarItem {
  readonly name: string;
  readonly personal: string;
  readonly average: string;
  readonly maxScore: string;
  readonly raw: Record<string, unknown>;
}

export interface YearScoreStatic {
  readonly year: string;
  readonly term: string;
  readonly yearDisplay: string;
  readonly termDisplay: string;
  /** 综测分数（未出分时为空串）。 */
  readonly score: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicReportYear {
  readonly year: string;
  readonly yearDisplay: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicReportYears {
  readonly years: AcademicReportYear[];
  readonly defaultYear: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicReportEntry {
  readonly courseName: string;
  readonly score: string;
  readonly credit: string;
  readonly courseNature: string;
  readonly year: string;
  readonly term: string;
  readonly raw: Record<string, unknown>;
}

export interface AcademicReportPage {
  readonly entries: AcademicReportEntry[];
  readonly totalSize: number;
  readonly pageNumber: number;
  readonly pageSize: number;
  readonly raw: Record<string, unknown>;
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class XgxtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XgxtError';
  }
}

/** 未登录或会话过期（HTTP 401/403 或被重定向到 CAS 登录页）。 */
export class XgxtNotLoggedInError extends XgxtError {
  constructor(message: string) {
    super(message);
    this.name = 'XgxtNotLoggedInError';
  }
}

/** 与学工系统的交互结果与协议预期不符。 */
export class XgxtProtocolError extends XgxtError {
  constructor(message: string) {
    super(message);
    this.name = 'XgxtProtocolError';
  }
}

/** 服务端按协议返回了非零业务码，属业务规则拒绝。 */
export class XgxtBusinessError extends XgxtError {
  readonly code: string | number | null;
  readonly msg: string | null;
  readonly url: string;

  constructor(code: string | number | null, msg: string | null, url: string) {
    super(`EMAP business error from ${url}: code=${code} msg=${msg}`);
    this.name = 'XgxtBusinessError';
    this.code = code;
    this.msg = msg;
    this.url = url;
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let xgxtJar = new SimpleCookieJar();
let timeoutMs = 30_000;
let inflightAuth: Promise<unknown> | null = null;
let inflightReauth: Promise<void> | null = null;
let appRoleReady = false;
let inflightRole: Promise<void> | null = null;
let sessionGeneration = 0;

export function getJar(): SimpleCookieJar {
  return xgxtJar;
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms;
}

export function resetXgxt(): void {
  xgxtJar = new SimpleCookieJar();
  inflightAuth = null;
  inflightReauth = null;
  appRoleReady = false;
  inflightRole = null;
  sessionGeneration = 0;
}

function baseUrl(): string {
  const url = getSchoolConfig().xgxt?.baseUrl;
  if (!url) {
    throw new XgxtProtocolError('xgxt base URL not configured for current school');
  }
  return url;
}

function cookieDomain(): string {
  return new URL(baseUrl()).hostname;
}

/** CAS service 入口（注意 CAS 侧登记的 service 是 http 方案）。 */
function zhcpServiceUrl(): string {
  return `${baseUrl().replace(/^https:/, 'http:')}/xsfw/sys/zhcptybbapp/*default/index.do`;
}

function buildApiUrl(path: string): string {
  return `${baseUrl()}/xsfw/sys/zhcptybbapp/${path}`;
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

/** 确保 session 已携带学工系统 cookie，并完成应用角色绑定。 */
async function ensureAuthorized(): Promise<void> {
  await getCredentialApplied();
  const cookies = await xgxtJar.getAllCookies();
  const hasSession = cookies.some((c) => c.domain && c.domain.includes(cookieDomain()));
  if (!hasSession) {
    if (inflightAuth) {
      await inflightAuth;
    } else {
      inflightAuth = authorize(zhcpServiceUrl(), xgxtJar);
      try {
        await inflightAuth;
      } finally {
        inflightAuth = null;
      }
    }
  }
  await ensureAppRole();
}

/**
 * 确保会话已绑定综合测评应用的角色上下文（如「学生组」）。
 *
 * 与 jwxt 的 _WEU 门槛同构：模块 API 要求会话先完成角色绑定，否则一律 404。
 * 幂等：只做一次；服务端侧重复激活无害。
 */
async function ensureAppRole(): Promise<void> {
  if (appRoleReady) return;
  if (inflightRole) {
    await inflightRole;
    return;
  }
  inflightRole = (async () => {
    const roleId = await fetchActiveRoleId();
    if (roleId !== null) {
      await activateRole(roleId);
    }
    appRoleReady = true;
  })();
  try {
    await inflightRole;
  } finally {
    inflightRole = null;
  }
}

/** 从应用配置中取当前激活角色 ID；无角色配置时返回 null。 */
async function fetchActiveRoleId(): Promise<string | null> {
  const result = await rawPost(
    `${baseUrl()}/xsfw/sys/swpubapp/indexmenu/getAppConfig.do`,
    { params: { appId: EMAP_APP_ID, appName: APP_NAME } },
  );
  if (result === null || typeof result !== 'object') return null;
  const header = (result as Record<string, unknown>)['HEADER'];
  const menu =
    header !== null && typeof header === 'object'
      ? (header as Record<string, unknown>)['dropMenu']
      : null;
  if (!Array.isArray(menu) || menu.length === 0) return null;
  const active =
    menu.find(
      (r) => r !== null && typeof r === 'object' && (r as Record<string, unknown>)['active'],
    ) ?? menu[0];
  const roleId =
    active !== null && typeof active === 'object'
      ? (active as Record<string, unknown>)['id']
      : null;
  if (!roleId) {
    throw new XgxtProtocolError(`getAppConfig 角色项缺少 id: ${JSON.stringify(active)}`);
  }
  return String(roleId);
}

/** 激活指定角色（两步，均为前端实际调用的接口）。 */
async function activateRole(roleId: string): Promise<void> {
  const setResult = await rawPost(
    `${baseUrl()}/xsfw/sys/swpubapp/userinfo/setXgCommonAppRole.do`,
    { data: { requestParamStr: JSON.stringify({ ROLEID: roleId }) } },
  );
  const returnCode =
    setResult !== null && typeof setResult === 'object'
      ? (setResult as Record<string, unknown>)['returnCode']
      : null;
  if (returnCode !== '#E000000000000') {
    throw new XgxtProtocolError(`setXgCommonAppRole 响应异常: ${JSON.stringify(setResult)}`);
  }

  const changeResult = await rawPost(
    `${baseUrl()}/xsfw/sys/funauthapp/api/changeAppRole/${APP_NAME}/${roleId}.do`,
  );
  const success =
    changeResult !== null && typeof changeResult === 'object'
      ? (changeResult as Record<string, unknown>)['success']
      : null;
  if (success !== true) {
    throw new XgxtProtocolError(`changeAppRole 响应异常: ${JSON.stringify(changeResult)}`);
  }
}

/** 握手端点专用 POST：不做 code envelope 解析，仅状态码检查与 JSON 解析。 */
async function rawPost(
  url: string,
  opts?: { params?: Record<string, string>; data?: Record<string, string> },
): Promise<unknown> {
  const query = opts?.params ? `?${new URLSearchParams(opts.params).toString()}` : '';
  let resp: HttpResponse;
  try {
    resp = await fetchWithJar(xgxtJar, {
      method: 'POST',
      url: `${url}${query}`,
      body: new URLSearchParams(opts?.data ?? {}),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
      redirect: 'follow',
      timeoutMs,
    });
  } catch (e) {
    throw new XgxtProtocolError(`request failed for ${url}: ${(e as Error).message}`);
  }
  const text = await resp.text();
  if (resp.status === 401 || resp.status === 403) {
    throw new XgxtNotLoggedInError(`HTTP ${resp.status} from ${url}`);
  }
  if (resp.status >= 400) {
    throw new XgxtProtocolError(`HTTP ${resp.status} from ${url}`);
  }
  const contentType = headerSingle(resp.headers, 'content-type') ?? '';
  if (contentType.includes('text/html') && text.includes('authserver/login')) {
    throw new XgxtNotLoggedInError('session expired, redirected to CAS login page');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new XgxtProtocolError(`non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

/** 显式作废当前会话，重新走 CAS 拿 ST，并恢复应用角色上下文。 */
async function reauthorize(failedGeneration: number): Promise<void> {
  if (sessionGeneration !== failedGeneration) return;
  if (inflightReauth) {
    await inflightReauth;
    return;
  }

  inflightReauth = (async () => {
    const domain = cookieDomain();
    const cookies = await xgxtJar.getAllCookies();
    for (const c of cookies) {
      if (c.domain && c.domain.includes(domain)) {
        await xgxtJar.removeCookie(c.domain, c.path ?? '/', c.name);
      }
    }
    appRoleReady = false;
    await authorize(zhcpServiceUrl(), xgxtJar);
    await ensureAppRole();
    sessionGeneration += 1;
  })();
  try {
    await inflightReauth;
  } finally {
    inflightReauth = null;
  }
}

/** 所有业务 API 调用的收口：POST、登录过期检测、envelope 解析、异常分层。 */
async function post(path: string, data: Record<string, string>): Promise<Record<string, unknown>> {
  const url = buildApiUrl(path);
  let resp: HttpResponse;
  try {
    resp = await fetchWithJar(xgxtJar, {
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
    throw new XgxtProtocolError(`request failed for ${url}: ${(e as Error).message}`);
  }
  const text = await resp.text();
  if (resp.status === 401 || resp.status === 403) {
    throw new XgxtNotLoggedInError(`HTTP ${resp.status} from ${url}`);
  }
  if (resp.status >= 400) {
    throw new XgxtProtocolError(`HTTP ${resp.status} from ${url}`);
  }
  // 会话过期时 EMAP 可能返回登录页 HTML 而非 JSON
  const contentType = headerSingle(resp.headers, 'content-type') ?? '';
  if (contentType.includes('text/html') && text.includes('authserver/login')) {
    throw new XgxtNotLoggedInError('session expired, redirected to CAS login page');
  }
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new XgxtProtocolError(`non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
  const code = result['code'];
  if (code !== '0' && code !== 0) {
    throw new XgxtBusinessError(
      (code as string | number | null) ?? null,
      (result['msg'] as string | null) ?? null,
      url,
    );
  }
  return result;
}

/** controller 风格接口：请求体为 data=<JSON>，响应取 data 字段。 */
async function postController(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const result = await post(path, { data: JSON.stringify(payload) });
  if (!('data' in result)) {
    throw new XgxtProtocolError(`missing 'data' field in response from ${buildApiUrl(path)}`);
  }
  return result['data'];
}

/** EMAP 列表风格接口：纯表单 POST，响应取 datas[key].rows 与分页节点。 */
async function postRows(
  path: string,
  form: Record<string, string>,
  key: string,
): Promise<{ rows: Record<string, unknown>[]; node: Record<string, unknown> }> {
  const result = await post(path, form);
  const url = buildApiUrl(path);
  const datas = result['datas'];
  if (datas === null || typeof datas !== 'object') {
    throw new XgxtProtocolError(`missing 'datas' field in response from ${url}`);
  }
  const nodeRaw = (datas as Record<string, unknown>)[key];
  let rows: unknown;
  let node: Record<string, unknown>;
  if (Array.isArray(nodeRaw)) {
    rows = nodeRaw;
    node = {};
  } else if (nodeRaw !== null && typeof nodeRaw === 'object') {
    node = nodeRaw as Record<string, unknown>;
    rows = node['rows'] ?? [];
  } else {
    rows = [];
    node = {};
  }
  if (!Array.isArray(rows)) {
    throw new XgxtProtocolError(`'rows' is not a list in response from ${url}`);
  }
  return { rows: rows as Record<string, unknown>[], node };
}

/** 会话过期时重新认证一次并重试（只重试一次）。 */
async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized();
  const requestGeneration = sessionGeneration;
  try {
    return await fn();
  } catch (e) {
    if (e instanceof XgxtNotLoggedInError) {
      await reauthorize(requestGeneration);
      return await fn();
    }
    throw e;
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────── //

function toStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

function toInt(val: unknown): number {
  const n = parseInt(toStr(val).trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** 把可选的 year/term 归一为具体的 (CPXN, CPXQ)；缺省时取最新测评批次。 */
async function resolveTerm(year?: string, term?: string): Promise<{ cpxn: string; cpxq: string }> {
  if (year !== undefined && term !== undefined) {
    return { cpxn: year, cpxq: term };
  }
  const terms = await queryEvaluationTerms();
  for (const t of terms) {
    if ((year === undefined || t.year === year) && (term === undefined || t.term === term)) {
      return { cpxn: t.year, cpxq: t.term };
    }
  }
  throw new XgxtProtocolError(
    `未找到匹配的测评学年学期: year=${year ?? ''} term=${term ?? ''}`,
  );
}

function parseTerm(r: Record<string, unknown>): EvaluationTerm {
  return {
    year: toStr(r['CPXN']),
    term: toStr(r['CPXQ']),
    yearDisplay: toStr(r['CPXN_DISPLAY']),
    termDisplay: toStr(r['CPXQ_DISPLAY']),
    wid: toStr(r['WID']),
    raw: r,
  };
}

function parseIndicator(r: Record<string, unknown>): EvaluationIndicator {
  return {
    name: toStr(r['ZBMC']),
    score: toStr(r['FS']),
    rank: toInt(r['RK']),
    maxScore: toStr(r['ZDZ']),
    category: toStr(r['ZBLB']),
    description: toStr(r['ZBSM']),
    raw: r,
  };
}

function parseResult(data: Record<string, unknown>): EvaluationResult {
  const zbList = data['ZBLIST'];
  return {
    totalScore: toStr(data['ZCJ']),
    classRank: toInt(data['BJPM']),
    classSize: toInt(data['BJRS']),
    gradeRank: toInt(data['ZYNJPM']),
    gradeSize: toInt(data['ZYNJRS']),
    year: toStr(data['CPXN']),
    term: toStr(data['CPXQ']),
    yearDisplay: toStr(data['CPXN_DISPLAY']),
    termDisplay: toStr(data['CPXQ_DISPLAY']),
    showMajorRank: Boolean(data['showZypm']),
    indicators: Array.isArray(zbList)
      ? zbList
          .filter((z): z is Record<string, unknown> => z !== null && typeof z === 'object')
          .map(parseIndicator)
      : [],
    raw: data,
  };
}

function parseIndicatorDetail(r: Record<string, unknown>): EvaluationIndicatorDetail {
  return {
    name: toStr(r['ZBMC']),
    score: toStr(r['FS']),
    maxScore: toStr(r['ZDZ']),
    rangeText: toStr(r['FZFW']),
    proportion: toStr(r['BL']),
    categoryDisplay: toStr(r['ZBLB_DISPLAY']),
    description: toStr(r['ZBSM']),
    raw: r,
  };
}

function parseRadarItem(r: Record<string, unknown>): EvaluationRadarItem {
  return {
    name: toStr(r['ZBMC']),
    personal: toStr(r['GR']),
    average: toStr(r['AVG']),
    maxScore: toStr(r['MAX']),
    raw: r,
  };
}

function parseYearScoreStatic(r: Record<string, unknown>): YearScoreStatic {
  return {
    year: toStr(r['XNZ']),
    term: toStr(r['XQZ']),
    yearDisplay: toStr(r['XNXSZ']),
    termDisplay: toStr(r['XQXSZ']),
    score: toStr(r['FS']),
    raw: r,
  };
}

function parseReportYear(r: Record<string, unknown>): AcademicReportYear {
  return {
    year: toStr(r['XNZ']),
    yearDisplay: toStr(r['XNXSZ']),
    raw: r,
  };
}

function parseReportEntry(r: Record<string, unknown>): AcademicReportEntry {
  return {
    courseName: toStr(r['KCMC']),
    score: toStr(r['ZCJ']),
    credit: toStr(r['XF']),
    courseNature: toStr(r['KCXZDM']),
    year: toStr(r['XN']),
    term: toStr(r['XQ']),
    raw: r,
  };
}

// ─── Public: 综测成绩 ─────────────────────────────────────────────────── //

/** 查询可查看综测成绩的学年学期列表（按时间倒序，首个为最新）。 */
export async function queryEvaluationTerms(): Promise<EvaluationTerm[]> {
  return runWithReauth(async () => {
    const data = await postController(API_PATHS.cpxnxq, {});
    const rows =
      data !== null && typeof data === 'object'
        ? (data as Record<string, unknown>)['XNXX']
        : null;
    if (!Array.isArray(rows)) {
      throw new XgxtProtocolError('getCpxnxq 响应缺少 XNXX 列表');
    }
    return rows
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map(parseTerm);
  });
}

/** 查询指定学年学期的综测成绩与班级/年级排名；缺省时取最新测评批次。 */
export async function queryEvaluationResult(
  year?: string,
  term?: string,
): Promise<EvaluationResult> {
  return runWithReauth(async () => {
    const { cpxn, cpxq } = await resolveTerm(year, term);
    const data = await postController(API_PATHS.cjByXn, { CPXN: cpxn, CPXQ: cpxq });
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new XgxtProtocolError('getEvaluationResultsByXn 响应 data 不是对象');
    }
    return parseResult(data as Record<string, unknown>);
  });
}

/** 查询指定学年学期的指标得分明细；缺省时取最新测评批次。 */
export async function queryEvaluationIndicators(
  year?: string,
  term?: string,
  opts?: { pageSize?: number; pageNumber?: number },
): Promise<EvaluationIndicatorDetail[]> {
  return runWithReauth(async () => {
    const { cpxn, cpxq } = await resolveTerm(year, term);
    const { rows } = await postRows(
      API_PATHS.zbxx,
      {
        XN: cpxn,
        XQ: cpxq,
        pageSize: String(opts?.pageSize ?? 100),
        pageNumber: String(opts?.pageNumber ?? 1),
      },
      'tjsqhqxqzbxx',
    );
    return rows.map(parseIndicatorDetail);
  });
}

/** 查询指定学年学期的指标雷达对比；缺省时取最新测评批次。 */
export async function queryEvaluationRadar(
  year?: string,
  term?: string,
): Promise<EvaluationRadarItem[]> {
  return runWithReauth(async () => {
    const { cpxn, cpxq } = await resolveTerm(year, term);
    const data = await postController(API_PATHS.redar, { CPXN: cpxn, CPXQ: cpxq });
    if (!Array.isArray(data)) {
      throw new XgxtProtocolError('getRedar 响应 data 不是数组');
    }
    return data
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map(parseRadarItem);
  });
}

/** 查询各学年学期的综测分数总览（「我和自己比一比」）。 */
export async function queryYearScoreStatics(): Promise<YearScoreStatic[]> {
  return runWithReauth(async () => {
    const data = await postController(API_PATHS.yearCjStatic, {});
    if (!Array.isArray(data)) {
      throw new XgxtProtocolError('getYearCjStatic 响应 data 不是数组');
    }
    return data
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
      .map(parseYearScoreStatic);
  });
}

// ─── Public: 学业成绩报告 ─────────────────────────────────────────────── //

/** 查询学业成绩报告的可选学年与默认学年。 */
export async function queryAcademicReportYears(): Promise<AcademicReportYears> {
  return runWithReauth(async () => {
    const [yearsRaw, defaultRaw] = await Promise.all([
      postController(API_PATHS.fiveYears, {}),
      postController(API_PATHS.mrXn, {}),
    ]);
    return {
      years: Array.isArray(yearsRaw)
        ? yearsRaw
            .filter((y): y is Record<string, unknown> => y !== null && typeof y === 'object')
            .map(parseReportYear)
        : [],
      defaultYear:
        defaultRaw !== null && typeof defaultRaw === 'object'
          ? toStr((defaultRaw as Record<string, unknown>)['DQXN'])
          : '',
      raw: { fiveYears: yearsRaw, mrXn: defaultRaw },
    };
  });
}

/** 查询学业成绩报告（按学年分页的课程成绩列表）；year 缺省时用服务端默认学年。 */
export async function queryAcademicReport(
  year?: string,
  opts?: { pageSize?: number; pageNumber?: number },
): Promise<AcademicReportPage> {
  return runWithReauth(async () => {
    let resolvedYear = year;
    if (resolvedYear === undefined) {
      const defaultRaw = await postController(API_PATHS.mrXn, {});
      resolvedYear =
        defaultRaw !== null && typeof defaultRaw === 'object'
          ? toStr((defaultRaw as Record<string, unknown>)['DQXN'])
          : '';
      if (!resolvedYear) {
        throw new XgxtProtocolError('getMrXn 响应缺少 DQXN 字段');
      }
    }
    const { rows, node } = await postRows(
      API_PATHS.xycjbg,
      {
        XN: resolvedYear,
        pageSize: String(opts?.pageSize ?? 100),
        pageNumber: String(opts?.pageNumber ?? 1),
      },
      'xycjbg',
    );
    return {
      entries: rows.map(parseReportEntry),
      totalSize: toInt(node['totalSize']),
      pageNumber: toInt(node['pageNumber']) || (opts?.pageNumber ?? 1),
      pageSize: toInt(node['pageSize']) || (opts?.pageSize ?? 100),
      raw: node,
    };
  });
}
