/**
 * 劳动教育实践课程管理平台 —— 只读查询模块。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import { errorMessage, isPlainRecord } from "../http-utils"
import type { CasAuthorizer } from "./cas"
import { toIsoDatetime } from "./datetime"
import { parseTables, type TableData } from "./table"

const LOGIN_PATH = "/System/User/Login"
const SSO_PATH = "/About/UnifiedAuthenticationLogin"
const HOME_PATH = "/System/Home/Index"
const SUMMARY_PATH = "/XueFen/Summary"
const SUMMARY_QUERY_PATH = "/XueFen/SummaryQuery/Index"
const ENROLL_PATH = "/XueFen/Enroll/Index"
const DEFAULT_PAGE_SIZE = 200

export interface LaborRecord {
  readonly term: string
  readonly name: string
  readonly enrollType: string
  readonly category: string
  readonly department: string
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
  readonly operation: string
  readonly raw: Record<string, unknown>
}

export class LdxtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "LdxtError"
  }
}

export class LdxtNotLoggedInError extends LdxtError {
  constructor(message: string) {
    super(message)
    this.name = "LdxtNotLoggedInError"
  }
}

export class LdxtProtocolError extends LdxtError {
  constructor(message: string) {
    super(message)
    this.name = "LdxtProtocolError"
  }
}

export interface LdxtProtocol {
  getJar(): CookieJar
  setTimeoutMs(ms: number): void
  resetLdxt(): void
  queryLaborRecords(opts?: {
    termCode?: string
    batchId?: string
    pageSize?: number
  }): Promise<LaborRecord[]>
  queryLaborSummary(): Promise<LaborSummary>
  queryEnrollableActivities(): Promise<EnrollableActivity[]>
}

function toFloat(val: string): number | null {
  if (!val) return null
  const n = Number(val)
  return Number.isNaN(n) ? null : n
}

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

export function createLDXT(ctx: YSUContext, cas: CasAuthorizer): LdxtProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  const configuredBaseUrl = ctx.config.ldxt?.baseUrl
  let ldxtJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let authorized = false
  let inflightAuth: Promise<void> | null = null

  function getJar(): CookieJar {
    return ldxtJar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  function resetLdxt(): void {
    ldxtJar = ctx.session.createCookieJar()
    authorized = false
    inflightAuth = null
  }

  function baseUrl(): string {
    if (!configuredBaseUrl) {
      throw new LdxtProtocolError("ldxt base URL not configured for current school")
    }
    return configuredBaseUrl
  }

  async function getPage(path: string, params?: Record<string, string | number>): Promise<string> {
    const query = params
      ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
      : ""
    const url = `${baseUrl()}${path}${query}`
    let resp: HttpResponse
    try {
      resp = await ctx.session.fetchWithJar(ldxtJar, {
        method: "GET",
        url,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new LdxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
    }
    let finalPath = ""
    try {
      finalPath = new URL(resp.url).pathname.replace(/\/+$/, "")
    } catch {
      // Unparseable resp.url treated as non-login destination.
    }
    if (finalPath === LOGIN_PATH) {
      throw new LdxtNotLoggedInError(`redirected to login page: ${url}`)
    }
    if (resp.status >= 400) {
      throw new LdxtProtocolError(`HTTP ${resp.status} from ${url}`)
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

      await cas.authorize(`${baseUrl()}${SSO_PATH}`, ldxtJar)

      const url = `${baseUrl()}${SSO_PATH}`
      let resp: HttpResponse
      try {
        resp = await ctx.session.fetchWithJar(ldxtJar, {
          method: "POST",
          url,
          redirect: "follow",
          timeoutMs,
        })
      } catch (e) {
        throw new LdxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(await resp.text())
      } catch {
        throw new LdxtProtocolError(`non-JSON response from ${url}`)
      }
      if (!isPlainRecord(parsed) || parsed["Success"] !== true) {
        const message = isPlainRecord(parsed) ? String(parsed["Message"] ?? "") : ""
        throw new LdxtNotLoggedInError(`SSO finalize rejected: ${message}`)
      }
      const data = parsed["Data"]
      const nextPath = isPlainRecord(data) ? data["Url"] : null
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

  async function queryLaborRecords(opts?: {
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

  async function queryLaborSummary(): Promise<LaborSummary> {
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

  async function queryEnrollableActivities(): Promise<EnrollableActivity[]> {
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

  return {
    getJar,
    setTimeoutMs,
    resetLdxt,
    queryLaborRecords,
    queryLaborSummary,
    queryEnrollableActivities,
  }
}
