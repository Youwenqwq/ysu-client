/**
 * 创新创业学分认定系统 —— 只读查询模块。
 *
 * 移植自 ysu-sdk 的 scxt 子包。与 ldxt 同为先极科技 ASP.NET MVC 系统，
 * 但认证必须经 ysu_pt 平台中转（本系统未直接注册为 CAS service）。
 * 表格解析共享 ./table。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import { SimpleCookieJar, fetchWithJar, headerSingle, type HttpResponse } from "@/lib/cookie"
import { waitForAuthTransition, withAuthTransition } from "../auth-transition"
import { authorize, getCredentialApplied } from "./cas"
import { parseTables, type TableData } from "./table"
import { getSchoolConfig } from "@/lib/server-config"

// ─── Constants ────────────────────────────────────────────────────────── //

/** 平台的 CAS 票据消费端点（authorize 的 service URL）。 */
const PT_CAS_LOGIN_PATH = "/UnifiedAuth/CASLogin"
/** 平台 → 子系统桥（双创学分认定系统的固定 guid）。 */
const SUBSYSTEM_BRIDGE_PATH =
  "/System/Platform/AccessSubsystem/e3090712-0609-404a-ade1-6a76ad8d90b1"

const LOGIN_PATH = "/System/User/Login"
const HOME_PATH = "/System/Home/Index"
/** 我的申报记录。 */
const DECLARE_PATH = "/XueFen/Declare/Index"
/** 学分汇总（认定记录，按批次过滤）。 */
const SUMMARY_PATH = "/XueFen/Summary"
/** 学生学分汇总。 */
const SUMMARY_QUERY_PATH = "/XueFen/SummaryQuery/Index"
/** 竞赛库。 */
const COMPETITION_PATH = "/JingSai/Declare/Index"
/** 活动库。 */
const ACTIVITY_PATH = "/HuoDongKu/Declare/Index"

const DEFAULT_PAGE_SIZE = 200
const ALL_BATCHES_CONCURRENCY = 4

const PAGER_RE = /共(\d+)页(\d+)条记录，当前显示：第\s*(\d+)\s*页/
const BATCH_SELECT_RE = /<select[^>]*name="BatchID"[^>]*>([\s\S]*?)<\/select>/i
const OPTION_RE = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi

// ─── Types ────────────────────────────────────────────────────────────── //

export interface CatalogPage<T> {
  readonly items: T[]
  /** 当前页码（1 起）。 */
  readonly pageIndex: number
  readonly totalPages: number
  readonly totalRecords: number
}

export interface CreditBatch {
  readonly batchId: string
  readonly name: string
  readonly raw: Record<string, unknown>
}

export interface CreditDeclaration {
  readonly itemName: string
  readonly categoryMajor: string
  readonly categoryMinor: string
  readonly awardLevel: string
  readonly score: number | null
  readonly applicant: string
  readonly batch: string
  readonly status: string
  readonly operation: string
  readonly raw: Record<string, unknown>
}

export interface CreditRecord {
  readonly itemName: string
  readonly year: string
  readonly categoryMajor: string
  readonly categoryMinor: string
  readonly awardLevel: string
  readonly referenceScore: number | null
  readonly actualScore: number | null
  readonly grade: string
  readonly applicant: string
  readonly className: string
  readonly department: string
  readonly batch: string
  readonly status: string
  readonly raw: Record<string, unknown>
}

export interface CreditSummary {
  readonly studentId: string
  readonly name: string
  readonly department: string
  readonly major: string
  readonly className: string
  readonly gradeYear: string
  readonly grade: string
  readonly totalCredits: number | null
  readonly raw: Record<string, unknown>
}

export interface Competition {
  readonly code: string
  readonly name: string
  readonly categoryMajor: string
  readonly categoryMinor: string
  readonly isEnabled: boolean
  readonly status: string
  readonly raw: Record<string, unknown>
}

export interface LibraryActivity {
  readonly name: string
  readonly organizer: string
  readonly category: string
  readonly detail: string
  readonly raw: Record<string, unknown>
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class ScxtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScxtError"
  }
}

/** 会话未认证或已过期（请求被重定向回登录页）。 */
export class ScxtNotLoggedInError extends ScxtError {
  constructor(message: string) {
    super(message)
    this.name = "ScxtNotLoggedInError"
  }
}

/** 响应与预期不符（非 200、桥接失败、页面中找不到数据表格等）。 */
export class ScxtProtocolError extends ScxtError {
  constructor(message: string) {
    super(message)
    this.name = "ScxtProtocolError"
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let scxtJar = new SimpleCookieJar()
let timeoutMs = 30_000
let authorized = false
let inflightAuth: Promise<void> | null = null
let cachedCreditBatches: CreditBatch[] | null = null
let inflightCreditBatches: Promise<CreditBatch[]> | null = null

export function getJar(): SimpleCookieJar {
  return scxtJar
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms
}

export function resetScxt(): void {
  scxtJar = new SimpleCookieJar()
  authorized = false
  inflightAuth = null
  cachedCreditBatches = null
  inflightCreditBatches = null
}

function scxtConfig(): { baseUrl: string; ptBaseUrl: string } {
  const config = getSchoolConfig().scxt
  if (!config) {
    throw new ScxtProtocolError("scxt base URLs not configured for current school")
  }
  return config
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

/**
 * 懒认证：平台出票 → 子系统桥 → 票据落地，三步建立 ysu_xf 会话。
 *
 * 桥接与票据请求都必须带平台主页 Referer，否则平台拒绝出票、
 * 子系统报「访问参数获取失败」。
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

    const { baseUrl, ptBaseUrl } = scxtConfig()
    const ptHomeUrl = `${ptBaseUrl}${HOME_PATH}`
    const referer = { Referer: ptHomeUrl }

    await authorize(`${ptBaseUrl}${PT_CAS_LOGIN_PATH}`, scxtJar)

    const bridgeUrl = `${ptBaseUrl}${SUBSYSTEM_BRIDGE_PATH}`
    let resp: HttpResponse
    try {
      resp = await fetchWithJar(scxtJar, {
        method: "GET",
        url: bridgeUrl,
        headers: referer,
        redirect: "manual",
        timeoutMs,
      })
    } catch (e) {
      throw new ScxtProtocolError(`request failed for ${bridgeUrl}: ${(e as Error).message}`)
    }
    const ticketUrl = headerSingle(resp.headers, "location") ?? ""
    if ((resp.status !== 301 && resp.status !== 302) || !ticketUrl.includes("authserver/access")) {
      throw new ScxtProtocolError(
        `subsystem bridge did not issue access ticket: ${resp.status} -> ${ticketUrl}`
      )
    }

    try {
      resp = await fetchWithJar(scxtJar, {
        method: "GET",
        url: ticketUrl,
        headers: referer,
        redirect: "manual",
        timeoutMs,
      })
    } catch (e) {
      throw new ScxtProtocolError(`access ticket consumption failed: ${(e as Error).message}`)
    }
    if (resp.status !== 301 && resp.status !== 302) {
      throw new ScxtNotLoggedInError(`access ticket rejected: HTTP ${resp.status}`)
    }
    // 完整跟随票据落地链（LoginRole），再访问主页——服务端会话状态经
    // 主页初始化后，列表页才会渲染完整列（否则缺「成绩」等列）
    const landing = headerSingle(resp.headers, "location") ?? ""
    if (landing) {
      await getPageAbs(new URL(landing, ticketUrl).href)
    }
    await getPageAbs(`${baseUrl}${HOME_PATH}`)
    authorized = true
  })

  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

/** GET 绝对 URL（认证流程内部用，不做登录页检测）。 */
async function getPageAbs(url: string): Promise<string> {
  let resp: HttpResponse
  try {
    resp = await fetchWithJar(scxtJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    throw new ScxtProtocolError(`request failed for ${url}: ${(e as Error).message}`)
  }
  if (resp.status >= 400) {
    throw new ScxtProtocolError(`HTTP ${resp.status} from ${url}`)
  }
  return resp.text()
}

/** GET 一个服务端渲染页面；被踢回登录页时抛 ScxtNotLoggedInError。 */
async function getPage(path: string, params?: Record<string, string | number>): Promise<string> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : ""
  const url = `${scxtConfig().baseUrl}${path}${query}`
  let resp: HttpResponse
  try {
    resp = await fetchWithJar(scxtJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    throw new ScxtProtocolError(`request failed for ${url}: ${(e as Error).message}`)
  }
  let finalPath = ""
  try {
    finalPath = new URL(resp.url).pathname.replace(/\/+$/, "")
  } catch {
    // resp.url 不可解析时视为未跳转登录页
  }
  if (finalPath === LOGIN_PATH) {
    throw new ScxtNotLoggedInError(`redirected to login page: ${url}`)
  }
  if (resp.status >= 400) {
    throw new ScxtProtocolError(`HTTP ${resp.status} from ${url}`)
  }
  return resp.text()
}

/** GET 页面并返回（第一张顶层表格, 原始 HTML）。 */
async function getTable(
  path: string,
  params?: Record<string, string | number>
): Promise<{ table: TableData; html: string }> {
  const html = await getPage(path, params)
  const tables = parseTables(html)
  if (tables.length === 0) {
    throw new ScxtProtocolError(`no data table found in page: ${path}`)
  }
  return { table: tables[0]!, html }
}

/** 会话过期时重新认证一次并重试。 */
async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ScxtNotLoggedInError) {
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

/** 解析 ``共73页1448条记录，当前显示：第 1 页`` → (页数, 条数, 当前页)。 */
function parsePager(html: string): {
  totalPages: number
  totalRecords: number
  current: number
} {
  const m = PAGER_RE.exec(html)
  if (!m) return { totalPages: 1, totalRecords: 0, current: 1 }
  return {
    totalPages: parseInt(m[1]!, 10),
    totalRecords: parseInt(m[2]!, 10),
    current: parseInt(m[3]!, 10),
  }
}

// ─── Public: 批次 ─────────────────────────────────────────────────────── //

/**
 * 查询学分认定批次列表（申报页 BatchID 下拉框）。
 *
 * 学分汇总页服务端默认只给当前批次，要查全部记录需按批次遍历。
 */
export async function queryCreditBatches(): Promise<CreditBatch[]> {
  if (cachedCreditBatches) return cachedCreditBatches
  if (inflightCreditBatches) return inflightCreditBatches

  inflightCreditBatches = runWithReauth(async () => {
    const html = await getPage(DECLARE_PATH)
    const m = BATCH_SELECT_RE.exec(html)
    if (!m) {
      throw new ScxtProtocolError("BatchID select not found on declare page")
    }
    const batches: CreditBatch[] = []
    OPTION_RE.lastIndex = 0
    let opt: RegExpExecArray | null
    while ((opt = OPTION_RE.exec(m[1]!)) !== null) {
      const value = opt[1]!
      const name = opt[2]!.replace(/\s+/g, " ").trim()
      if (value && name && !name.includes("请选择")) {
        batches.push({ batchId: value, name, raw: { value, text: name } })
      }
    }
    cachedCreditBatches = batches
    return batches
  })
  try {
    return await inflightCreditBatches
  } finally {
    inflightCreditBatches = null
  }
}

// ─── Public: 申报记录 ─────────────────────────────────────────────────── //

/** 查询我的学分申报记录（默认服务端当前批次口径）。 */
export async function queryCreditDeclarations(opts?: {
  batchId?: string
  itemName?: string
}): Promise<CreditDeclaration[]> {
  return runWithReauth(async () => {
    const { table } = await getTable(DECLARE_PATH, {
      BatchID: opts?.batchId ?? "",
      ItemName: opts?.itemName ?? "",
    })
    const cols = colMap(table.headers)
    return table.rows.map((row) => ({
      itemName: cell(row, cols, "项目名称"),
      categoryMajor: cell(row, cols, "认定大类"),
      categoryMinor: cell(row, cols, "认定小类"),
      awardLevel: cell(row, cols, "获奖等级或排名"),
      score: toFloat(cell(row, cols, "分值")),
      applicant: cell(row, cols, "学分申请人"),
      batch: cell(row, cols, "所属批次"),
      status: cell(row, cols, "状态"),
      operation: cell(row, cols, "操作"),
      raw: zipRaw(table.headers, row),
    }))
  })
}

// ─── Public: 学分汇总（认定记录） ─────────────────────────────────────── //

/**
 * 查询学分汇总（认定记录）。
 *
 * 注意：batchId 为空时服务端只返回当前批次的记录，
 * 查全部批次请用 queryAllCreditRecords。
 */
export async function queryCreditRecords(opts?: {
  batchId?: string
  itemName?: string
  year?: string
  pageSize?: number
}): Promise<CreditRecord[]> {
  return runWithReauth(async () => {
    const { table } = await getTable(SUMMARY_PATH, {
      AscSortKey: "",
      DescSortKey: "",
      BatchID: opts?.batchId ?? "",
      ManagerID: "",
      CategoryCode1: "",
      CategoryCode2: "",
      CategoryCode3: "",
      ItemName: opts?.itemName ?? "",
      Grade: "",
      GetCGYear: opts?.year ?? "",
      IsGuiDang: "",
      PageSize: opts?.pageSize ?? DEFAULT_PAGE_SIZE,
    })
    const cols = colMap(table.headers)
    return table.rows.map((row) => ({
      itemName: cell(row, cols, "项目名称"),
      year: cell(row, cols, "取得成果年份"),
      categoryMajor: cell(row, cols, "认定大类"),
      categoryMinor: cell(row, cols, "认定小类"),
      awardLevel: cell(row, cols, "获奖等级或排名"),
      referenceScore: toFloat(cell(row, cols, "参照分值")),
      actualScore: toFloat(cell(row, cols, "实际分值")),
      grade: cell(row, cols, "成绩"),
      applicant: cell(row, cols, "学分申请人"),
      className: cell(row, cols, "所属班级"),
      department: cell(row, cols, "所属学院"),
      batch: cell(row, cols, "所属批次"),
      status: cell(row, cols, "状态"),
      raw: zipRaw(table.headers, row),
    }))
  })
}

/** 遍历全部批次查询认定记录（每批次一次请求，限制并发以保护服务端会话）。 */
export async function queryAllCreditRecords(): Promise<CreditRecord[]> {
  const batches = await queryCreditBatches()
  const pages = new Array<CreditRecord[]>(batches.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < batches.length) {
      const index = nextIndex++
      pages[index] = await queryCreditRecords({
        batchId: batches[index]!.batchId,
      })
    }
  }
  const workerCount = Math.min(ALL_BATCHES_CONCURRENCY, batches.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return pages.flat()
}

// ─── Public: 学生学分汇总 ─────────────────────────────────────────────── //

/** 查询本人学分总表（总学分/成绩）。 */
export async function queryCreditSummary(): Promise<CreditSummary> {
  return runWithReauth(async () => {
    const { table } = await getTable(SUMMARY_QUERY_PATH)
    const cols = colMap(table.headers)
    const row = table.rows[0]
    if (!row) {
      throw new ScxtProtocolError("no summary row found in page")
    }
    return {
      studentId: cell(row, cols, "账号"),
      name: cell(row, cols, "用户名"),
      department: cell(row, cols, "学院"),
      major: cell(row, cols, "专业"),
      className: cell(row, cols, "班级"),
      gradeYear: cell(row, cols, "年级"),
      grade: cell(row, cols, "成绩"),
      totalCredits: toFloat(cell(row, cols, "总学分")),
      raw: zipRaw(table.headers, row),
    }
  })
}

// ─── Public: 竞赛库 / 活动库 ──────────────────────────────────────────── //

/**
 * 查询竞赛库（分页，每页固定 20 条，共千余条）。
 *
 * isEnable 为厂商代码（是/否 对应值原样透传），分页信息在返回值上。
 */
export async function queryCompetitions(opts?: {
  itemCode?: string
  itemName?: string
  isEnable?: string
  pageIndex?: number
}): Promise<CatalogPage<Competition>> {
  return runWithReauth(async () => {
    const { table, html } = await getTable(COMPETITION_PATH, {
      ItemCode: opts?.itemCode ?? "",
      ItemName: opts?.itemName ?? "",
      IsEnable: opts?.isEnable ?? "",
      pageIndex: opts?.pageIndex ?? 1,
    })
    const pager = parsePager(html)
    const cols = colMap(table.headers)
    return {
      items: table.rows.map((row) => ({
        code: cell(row, cols, "竞赛编码"),
        name: cell(row, cols, "竞赛名称"),
        categoryMajor: cell(row, cols, "认定大类"),
        categoryMinor: cell(row, cols, "认定小类"),
        isEnabled: cell(row, cols, "是否启用") === "是",
        status: cell(row, cols, "状态"),
        raw: zipRaw(table.headers, row),
      })),
      pageIndex: pager.current,
      totalPages: pager.totalPages,
      totalRecords: pager.totalRecords,
    }
  })
}

/** 查询活动库（分页，每页固定 20 条）。 */
export async function queryLibraryActivities(opts?: {
  name?: string
  pageIndex?: number
}): Promise<CatalogPage<LibraryActivity>> {
  return runWithReauth(async () => {
    const { table, html } = await getTable(ACTIVITY_PATH, {
      HuoDongName: opts?.name ?? "",
      pageIndex: opts?.pageIndex ?? 1,
    })
    const pager = parsePager(html)
    const cols = colMap(table.headers)
    return {
      items: table.rows.map((row) => ({
        name: cell(row, cols, "活动名称"),
        organizer: cell(row, cols, "举办单位"),
        category: cell(row, cols, "活动类别"),
        detail: cell(row, cols, "详情"),
        raw: zipRaw(table.headers, row),
      })),
      pageIndex: pager.current,
      totalPages: pager.totalPages,
      totalRecords: pager.totalRecords,
    }
  })
}
