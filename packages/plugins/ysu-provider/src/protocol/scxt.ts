/**
 * 创新创业学分认定系统 —— 只读查询模块。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import { errorMessage, headerSingle } from "../http-utils"
import type { CasAuthorizer } from "./cas"
import { parseTables, type TableData } from "./table"

const PT_CAS_LOGIN_PATH = "/UnifiedAuth/CASLogin"
const SUBSYSTEM_BRIDGE_PATH =
  "/System/Platform/AccessSubsystem/e3090712-0609-404a-ade1-6a76ad8d90b1"

const LOGIN_PATH = "/System/User/Login"
const HOME_PATH = "/System/Home/Index"
const DECLARE_PATH = "/XueFen/Declare/Index"
const SUMMARY_PATH = "/XueFen/Summary"
const SUMMARY_QUERY_PATH = "/XueFen/SummaryQuery/Index"
const COMPETITION_PATH = "/JingSai/Declare/Index"
const ACTIVITY_PATH = "/HuoDongKu/Declare/Index"

const DEFAULT_PAGE_SIZE = 200
const ALL_BATCHES_CONCURRENCY = 4

const PAGER_RE = /共(\d+)页(\d+)条记录，当前显示：第\s*(\d+)\s*页/
const BATCH_SELECT_RE = /<select[^>]*name="BatchID"[^>]*>([\s\S]*?)<\/select>/i
const OPTION_RE = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi

export interface CatalogPage<T> {
  readonly items: T[]
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

export class ScxtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScxtError"
  }
}

export class ScxtNotLoggedInError extends ScxtError {
  constructor(message: string) {
    super(message)
    this.name = "ScxtNotLoggedInError"
  }
}

export class ScxtProtocolError extends ScxtError {
  constructor(message: string) {
    super(message)
    this.name = "ScxtProtocolError"
  }
}

export interface ScxtProtocol {
  getJar(): CookieJar
  setTimeoutMs(ms: number): void
  resetScxt(): void
  queryCreditBatches(): Promise<CreditBatch[]>
  queryCreditDeclarations(opts?: {
    batchId?: string
    itemName?: string
  }): Promise<CreditDeclaration[]>
  queryCreditRecords(opts?: {
    batchId?: string
    itemName?: string
    year?: string
  }): Promise<CreditRecord[]>
  queryAllCreditRecords(): Promise<CreditRecord[]>
  queryCreditSummary(): Promise<CreditSummary>
  queryCompetitions(opts?: {
    itemName?: string
    pageIndex?: number
  }): Promise<CatalogPage<Competition>>
  queryLibraryActivities(opts?: {
    name?: string
    pageIndex?: number
  }): Promise<CatalogPage<LibraryActivity>>
}

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

export function createSCXT(ctx: YSUContext, cas: CasAuthorizer): ScxtProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  const scxtBaseUrl = ctx.config.scxt?.baseUrl
  const scxtPtBaseUrl = ctx.config.scxt?.ptBaseUrl
  let scxtJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let authorized = false
  let inflightAuth: Promise<void> | null = null
  let cachedCreditBatches: CreditBatch[] | null = null
  let inflightCreditBatches: Promise<CreditBatch[]> | null = null

  function getJar(): CookieJar {
    return scxtJar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  function resetScxt(): void {
    scxtJar = ctx.session.createCookieJar()
    authorized = false
    inflightAuth = null
    cachedCreditBatches = null
    inflightCreditBatches = null
  }

  function scxtConfig(): { baseUrl: string; ptBaseUrl: string } {
    if (!scxtBaseUrl || !scxtPtBaseUrl) {
      throw new ScxtProtocolError("scxt base URLs not configured for current school")
    }
    return { baseUrl: scxtBaseUrl, ptBaseUrl: scxtPtBaseUrl }
  }

  async function getPageAbs(url: string): Promise<string> {
    let resp: HttpResponse
    try {
      resp = await ctx.session.fetchWithJar(scxtJar, {
        method: "GET",
        url,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new ScxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
    }
    if (resp.status >= 400) {
      throw new ScxtProtocolError(`HTTP ${resp.status} from ${url}`)
    }
    return resp.text()
  }

  async function ensureAuthorized(): Promise<void> {
    await waitForAuthTransition()
    if (authorized) return
    await cas.getCredentialApplied()
    if (inflightAuth) {
      await inflightAuth
      return
    }

    const promise = withAuthTransition(async () => {
      if (authorized) return

      const { baseUrl, ptBaseUrl } = scxtConfig()
      const ptHomeUrl = `${ptBaseUrl}${HOME_PATH}`
      const referer = { Referer: ptHomeUrl }

      await cas.authorize(`${ptBaseUrl}${PT_CAS_LOGIN_PATH}`, scxtJar)

      const bridgeUrl = `${ptBaseUrl}${SUBSYSTEM_BRIDGE_PATH}`
      let resp: HttpResponse
      try {
        resp = await ctx.session.fetchWithJar(scxtJar, {
          method: "GET",
          url: bridgeUrl,
          headers: referer,
          redirect: "manual",
          timeoutMs,
        })
      } catch (e) {
        throw new ScxtProtocolError(`request failed for ${bridgeUrl}: ${errorMessage(e)}`)
      }
      const ticketUrl = headerSingle(resp.headers, "location") ?? ""
      if (
        (resp.status !== 301 && resp.status !== 302) ||
        !ticketUrl.includes("authserver/access")
      ) {
        throw new ScxtNotLoggedInError(
          `subsystem bridge did not issue access ticket: ${resp.status} -> ${ticketUrl}`
        )
      }

      try {
        resp = await ctx.session.fetchWithJar(scxtJar, {
          method: "GET",
          url: ticketUrl,
          headers: referer,
          redirect: "manual",
          timeoutMs,
        })
      } catch (e) {
        throw new ScxtProtocolError(`access ticket consumption failed: ${errorMessage(e)}`)
      }
      if (resp.status !== 301 && resp.status !== 302) {
        throw new ScxtNotLoggedInError(`access ticket rejected: HTTP ${resp.status}`)
      }
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

  async function getPage(path: string, params?: Record<string, string | number>): Promise<string> {
    const query = params
      ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
      : ""
    const url = `${scxtConfig().baseUrl}${path}${query}`
    let resp: HttpResponse
    try {
      resp = await ctx.session.fetchWithJar(scxtJar, {
        method: "GET",
        url,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new ScxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
    }
    let finalPath = ""
    try {
      finalPath = new URL(resp.url).pathname.replace(/\/+$/, "")
    } catch {
      // Unparseable resp.url treated as non-login destination.
    }
    if (finalPath === LOGIN_PATH) {
      throw new ScxtNotLoggedInError(`redirected to login page: ${url}`)
    }
    if (resp.status >= 400) {
      throw new ScxtProtocolError(`HTTP ${resp.status} from ${url}`)
    }
    return resp.text()
  }

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

  async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await ensureAuthorized()
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

  async function queryCreditBatches(): Promise<CreditBatch[]> {
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

  async function queryCreditDeclarations(opts?: {
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

  async function queryCreditRecords(opts?: {
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

  async function queryAllCreditRecords(): Promise<CreditRecord[]> {
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

  async function queryCreditSummary(): Promise<CreditSummary> {
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

  async function queryCompetitions(opts?: {
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

  async function queryLibraryActivities(opts?: {
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

  return {
    getJar,
    setTimeoutMs,
    resetScxt,
    queryCreditBatches,
    queryCreditDeclarations,
    queryCreditRecords,
    queryAllCreditRecords,
    queryCreditSummary,
    queryCompetitions,
    queryLibraryActivities,
  }
}
