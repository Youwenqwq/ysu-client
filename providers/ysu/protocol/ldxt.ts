/**
 * 劳动教育实践课程管理平台 —— 只读查询模块。
 *
 * 移植自 ysu-sdk 的 ldxt 子包：南京先极科技的 ASP.NET MVC 系统，
 * CAS 单点登录 + 服务端渲染 HTML 表格，与 EMAP 系模块（jwxt）无共享代码。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import { SimpleCookieJar, fetchWithJar, type HttpResponse } from "@/lib/cookie"
import { authorize, getCredentialApplied } from "./cas"
import { waitForAuthTransition, withAuthTransition } from "../auth-transition"
import { parseTables, type TableData } from "./table"
import { toIsoDatetime } from "./datetime"
import { getSchoolConfig } from "@/lib/server-config"

// ─── Constants ────────────────────────────────────────────────────────── //

/** 登录页（未认证请求会被 302 到这里）。 */
const LOGIN_PATH = "/System/User/Login"
/** CAS 单点登录端点（authorize 的 service URL，也是登录确认 POST 的目标）。 */
const SSO_PATH = "/About/UnifiedAuthenticationLogin"
/** 主页（角色落地 URL 缺失时的后备）。 */
const HOME_PATH = "/System/Home/Index"
/** 时长汇总（劳动记录列表）。 */
const SUMMARY_PATH = "/XueFen/Summary"
/** 学生学分汇总。 */
const SUMMARY_QUERY_PATH = "/XueFen/SummaryQuery/Index"
/** 活动报名列表。 */
const ENROLL_PATH = "/XueFen/Enroll/Index"
/** 列表页可选每页 20/50/100/200，默认拉最大档避免翻页。 */
const DEFAULT_PAGE_SIZE = 200

// ─── Types ────────────────────────────────────────────────────────────── //

export interface LaborRecord {
  readonly term: string
  readonly name: string
  /** 报名来源徽标（如 教师选择），无则为空串。 */
  readonly enrollType: string
  readonly category: string
  readonly department: string
  /** RFC3339，未识别则原样。 */
  readonly timeStart: string
  readonly timeEnd: string
  readonly teacher: string
  readonly hours: number | null
  readonly student: string
  readonly status: string
  readonly raw: Record<string, unknown>
}

export interface LaborSummary {
  readonly studentId: string
  readonly name: string
  readonly department: string
  readonly major: string
  readonly className: string
  readonly grade: string
  readonly schooling: string
  readonly totalHours: number | null
  readonly totalCredits: number | null
  readonly raw: Record<string, unknown>
}

export interface EnrollableActivity {
  readonly name: string
  readonly category: string
  readonly timeStart: string
  readonly timeEnd: string
  readonly location: string
  readonly hours: number | null
  readonly description: string
  readonly department: string
  readonly enrollStart: string
  readonly enrollEnd: string
  readonly isEnrolled: boolean
  /** 操作列状态（如 不在报名时间）。 */
  readonly operation: string
  readonly raw: Record<string, unknown>
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class LdxtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LdxtError"
  }
}

/** 会话未认证或已过期（请求被重定向回登录页）。 */
export class LdxtNotLoggedInError extends LdxtError {
  constructor(message: string) {
    super(message)
    this.name = "LdxtNotLoggedInError"
  }
}

/** 响应与预期不符（非 200、页面中找不到数据表格等）。 */
export class LdxtProtocolError extends LdxtError {
  constructor(message: string) {
    super(message)
    this.name = "LdxtProtocolError"
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let ldxtJar = new SimpleCookieJar()
let timeoutMs = 30_000
let authorized = false
let inflightAuth: Promise<void> | null = null

export function getJar(): SimpleCookieJar {
  return ldxtJar
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms
}

export function resetLdxt(): void {
  ldxtJar = new SimpleCookieJar()
  authorized = false
  inflightAuth = null
}

function baseUrl(): string {
  const url = getSchoolConfig().ldxt?.baseUrl
  if (!url) {
    throw new LdxtProtocolError("ldxt base URL not configured for current school")
  }
  return url
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

/**
 * 懒认证：首次业务请求时完成 SSO 握手建立 ASP.NET 会话。
 *
 * 三步握手（浏览器实测）：
 * 1. cas.authorize(UnifiedAuthenticationLogin) —— 出票、服务端验票并种
 *    .DotNetCasClientAuth cookie；
 * 2. POST UnifiedAuthenticationLogin —— 服务端确认登录，返回 JSON
 *    {Success:true, Data:{Url:"/System/User/LoginRole"}}；
 * 3. GET 返回的角色落地 URL —— 写入角色上下文，会话就绪。
 */
async function ensureAuthorized(): Promise<void> {
  await waitForAuthTransition()
  if (authorized) return
  await getCredentialApplied()
  if (inflightAuth) {
    await inflightAuth
    return
  }

  const promise = withAuthTransition(async () => {
    if (authorized) return

    await authorize(`${baseUrl()}${SSO_PATH}`, ldxtJar)

    const url = `${baseUrl()}${SSO_PATH}`
    let resp: HttpResponse
    try {
      resp = await fetchWithJar(ldxtJar, {
        method: "POST",
        url,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new LdxtProtocolError(`request failed for ${url}: ${(e as Error).message}`)
    }
    let result: Record<string, unknown>
    try {
      result = JSON.parse(await resp.text()) as Record<string, unknown>
    } catch {
      throw new LdxtProtocolError(`non-JSON response from ${url}`)
    }
    if (result["Success"] !== true) {
      throw new LdxtNotLoggedInError(`SSO finalize rejected: ${String(result["Message"] ?? "")}`)
    }
    const data = result["Data"]
    const nextPath =
      data !== null && typeof data === "object" ? (data as Record<string, unknown>)["Url"] : null
    // 落地页本身可能是角色选择页（LoginRole），只要未被踢回登录页即就绪
    await getPage(typeof nextPath === "string" && nextPath ? nextPath : HOME_PATH)
    authorized = true
  })

  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

/** GET 一个服务端渲染页面；被踢回登录页时抛 LdxtNotLoggedInError。 */
async function getPage(path: string, params?: Record<string, string | number>): Promise<string> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : ""
  const url = `${baseUrl()}${path}${query}`
  let resp: HttpResponse
  try {
    resp = await fetchWithJar(ldxtJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    throw new LdxtProtocolError(`request failed for ${url}: ${(e as Error).message}`)
  }
  let finalPath = ""
  try {
    finalPath = new URL(resp.url).pathname.replace(/\/+$/, "")
  } catch {
    // resp.url 不可解析时视为未跳转登录页
  }
  if (finalPath === LOGIN_PATH) {
    throw new LdxtNotLoggedInError(`redirected to login page: ${url}`)
  }
  if (resp.status >= 400) {
    throw new LdxtProtocolError(`HTTP ${resp.status} from ${url}`)
  }
  return resp.text()
}

/** GET 页面并抽取第一张顶层表格。 */
async function getTable(
  path: string,
  params?: Record<string, string | number>
): Promise<TableData> {
  const html = await getPage(path, params)
  const tables = parseTables(html)
  if (tables.length === 0) {
    throw new LdxtProtocolError(`no data table found in page: ${path}`)
  }
  return tables[0]!
}

/** 会话过期时重新认证一次并重试（与 jwxt runWithReauth 同一模式）。 */
async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof LdxtNotLoggedInError) {
      authorized = false
      await ensureAuthorized()
      await waitForAuthTransition()
      return await fn()
    }
    throw e
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────── //

function toFloat(val: string): number | null {
  if (!val) return null
  const n = Number(val)
  return Number.isNaN(n) ? null : n
}

/** 把 ``2024-09-28 08:00 至 2024-09-28 12:00`` 拆成起止并归一。 */
function splitTimeRange(text: string): { start: string; end: string } {
  const sep = text.indexOf("至")
  const start = toIsoDatetime((sep === -1 ? text : text.slice(0, sep)).trim())
  const end = sep === -1 ? "" : toIsoDatetime(text.slice(sep + 1).trim())
  return { start, end }
}

function colMap(headers: readonly string[]): Record<string, number> {
  const map: Record<string, number> = {}
  headers.forEach((h, i) => {
    if (h) map[h] = i
  })
  return map
}

function cell(row: readonly string[], cols: Record<string, number>, name: string): string {
  const idx = cols[name]
  if (idx === undefined || idx >= row.length) return ""
  return row[idx]!
}

function zipRaw(headers: readonly string[], row: readonly string[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    if (i < row.length) raw[h] = row[i]
  })
  return raw
}

// ─── Public: 劳动记录 ─────────────────────────────────────────────────── //

/**
 * 查询本人劳动记录（时长汇总页的「劳动列表」）。
 *
 * 过滤参数为厂商内部代码，原样透传；默认全部为空即查询全部记录，
 * 每页取最大档（200 条）避免翻页。
 */
export async function queryLaborRecords(opts?: {
  termCode?: string
  batchId?: string
  categoryCode1?: string
  categoryCode2?: string
  grade?: string
  orgTeacher?: string
  pageSize?: number
}): Promise<LaborRecord[]> {
  return runWithReauth(async () => {
    const table = await getTable(SUMMARY_PATH, {
      AscSortKey: "",
      DescSortKey: "",
      TermCode: opts?.termCode ?? "",
      BatchID: opts?.batchId ?? "",
      CategoryCode1: opts?.categoryCode1 ?? "",
      CategoryCode2: opts?.categoryCode2 ?? "",
      Grade: opts?.grade ?? "",
      OrgTeacher: opts?.orgTeacher ?? "",
      PageSize: opts?.pageSize ?? DEFAULT_PAGE_SIZE,
    })
    const cols = colMap(table.headers)
    const nameIdx = cols["活动名称"]
    return table.rows.map((row, rowIdx) => {
      const { start, end } = splitTimeRange(cell(row, cols, "活动时间"))
      const badges = table.badges[rowIdx] ?? []
      const enrollType =
        nameIdx !== undefined && nameIdx < badges.length ? badges[nameIdx]!.join("") : ""
      return {
        term: cell(row, cols, "学期"),
        name: cell(row, cols, "活动名称"),
        enrollType,
        category: cell(row, cols, "活动大类"),
        department: cell(row, cols, "所属学院"),
        timeStart: start,
        timeEnd: end,
        teacher: cell(row, cols, "组织老师"),
        hours: toFloat(cell(row, cols, "劳动时长")),
        student: cell(row, cols, "学生"),
        status: cell(row, cols, "状态"),
        raw: zipRaw(table.headers, row),
      }
    })
  })
}

// ─── Public: 学生学分汇总 ─────────────────────────────────────────────── //

/** 查询本人劳动学分汇总（累计时长/总学分）。 */
export async function queryLaborSummary(): Promise<LaborSummary> {
  return runWithReauth(async () => {
    const table = await getTable(SUMMARY_QUERY_PATH)
    const cols = colMap(table.headers)
    const row = table.rows[0]
    if (!row) {
      throw new LdxtProtocolError("no summary row found in page")
    }
    return {
      studentId: cell(row, cols, "学生学号"),
      name: cell(row, cols, "学生姓名"),
      department: cell(row, cols, "学院"),
      major: cell(row, cols, "专业"),
      className: cell(row, cols, "班级"),
      grade: cell(row, cols, "年级"),
      schooling: cell(row, cols, "学制"),
      totalHours: toFloat(cell(row, cols, "劳动时长")),
      totalCredits: toFloat(cell(row, cols, "总学分")),
      raw: zipRaw(table.headers, row),
    }
  })
}

// ─── Public: 活动报名列表 ─────────────────────────────────────────────── //

/**
 * 查询活动报名列表（当前可见的可报名/历史活动）。
 *
 * 报名、上传佐证材料是写操作，未封装。
 */
export async function queryEnrollableActivities(): Promise<EnrollableActivity[]> {
  return runWithReauth(async () => {
    const table = await getTable(ENROLL_PATH)
    const cols = colMap(table.headers)
    return table.rows.map((row) => {
      const { start, end } = splitTimeRange(cell(row, cols, "活动时间"))
      const enroll = splitTimeRange(cell(row, cols, "报名时间"))
      return {
        name: cell(row, cols, "活动名称"),
        category: cell(row, cols, "活动大类"),
        timeStart: start,
        timeEnd: end,
        location: cell(row, cols, "活动地点"),
        hours: toFloat(cell(row, cols, "劳动时长")),
        description: cell(row, cols, "活动说明"),
        department: cell(row, cols, "所属学院"),
        enrollStart: enroll.start,
        enrollEnd: enroll.end,
        isEnrolled: cell(row, cols, "是否报名") === "是",
        operation: cell(row, cols, "操作"),
        raw: zipRaw(table.headers, row),
      }
    })
  })
}
