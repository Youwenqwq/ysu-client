/**
 * 学工系统（综合测评）—— 只读查询模块。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import { errorMessage, headerSingle, isPlainRecord } from "../http-utils"
import type { CasAuthorizer } from "./cas"

const APP_NAME = "zhcptybbapp"
const EMAP_APP_ID = "5275772372599202"

const API_PATHS = {
  cpxnxq: "modules/evaluationApplyController/getCpxnxq.do",
  cjByXn: "modules/evaluationApplyController/getEvaluationResultsByXn.do",
  yearCjStatic: "modules/evaluationApplyController/getYearCjStatic.do",
  redar: "modules/evaluationApplyController/getRedar.do",
  zbxx: "modules/zccj/tjsqhqxqzbxx.do",
  fiveYears: "modules/evaluationBjhpController/getFiveYears.do",
  mrXn: "modules/evaluationBjhpController/getMrXn.do",
  xycjbg: "modules/public/xycjbg.do",
} as const

export interface EvaluationTerm {
  readonly year: string
  readonly term: string
  readonly yearDisplay: string
  readonly termDisplay: string
  readonly wid: string
  readonly raw: Record<string, unknown>
}

export interface EvaluationIndicator {
  readonly name: string
  readonly score: string
  readonly rank: number
  readonly maxScore: string
  readonly category: string
  readonly description: string
  readonly raw: Record<string, unknown>
}

export interface EvaluationResult {
  readonly totalScore: string
  readonly classRank: number
  readonly classSize: number
  readonly gradeRank: number
  readonly gradeSize: number
  readonly year: string
  readonly term: string
  readonly yearDisplay: string
  readonly termDisplay: string
  readonly showMajorRank: boolean
  readonly indicators: EvaluationIndicator[]
  readonly raw: Record<string, unknown>
}

export interface EvaluationIndicatorDetail {
  readonly name: string
  readonly score: string
  readonly maxScore: string
  readonly rangeText: string
  readonly proportion: string
  readonly categoryDisplay: string
  readonly description: string
  readonly raw: Record<string, unknown>
}

export interface EvaluationRadarItem {
  readonly name: string
  readonly personal: string
  readonly average: string
  readonly maxScore: string
  readonly raw: Record<string, unknown>
}

export interface YearScoreStatic {
  readonly year: string
  readonly term: string
  readonly yearDisplay: string
  readonly termDisplay: string
  readonly score: string
  readonly raw: Record<string, unknown>
}

export interface AcademicReportYear {
  readonly year: string
  readonly yearDisplay: string
  readonly raw: Record<string, unknown>
}

export interface AcademicReportYears {
  readonly years: AcademicReportYear[]
  readonly defaultYear: string
  readonly raw: Record<string, unknown>
}

export interface AcademicReportEntry {
  readonly courseName: string
  readonly score: string
  readonly credit: string
  readonly courseNature: string
  readonly year: string
  readonly term: string
  readonly raw: Record<string, unknown>
}

export interface AcademicReportPage {
  readonly entries: AcademicReportEntry[]
  readonly totalSize: number
  readonly pageNumber: number
  readonly pageSize: number
  readonly raw: Record<string, unknown>
}

export class XgxtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "XgxtError"
  }
}

export class XgxtNotLoggedInError extends XgxtError {
  constructor(message: string) {
    super(message)
    this.name = "XgxtNotLoggedInError"
  }
}

export class XgxtProtocolError extends XgxtError {
  constructor(message: string) {
    super(message)
    this.name = "XgxtProtocolError"
  }
}

export class XgxtBusinessError extends XgxtError {
  readonly code: string | number | null
  readonly msg: string | null
  readonly url: string

  constructor(code: string | number | null, msg: string | null, url: string) {
    super(`EMAP business error from ${url}: code=${code} msg=${msg}`)
    this.name = "XgxtBusinessError"
    this.code = code
    this.msg = msg
    this.url = url
  }
}

export interface XgxtProtocol {
  getJar(): CookieJar
  setTimeoutMs(ms: number): void
  resetXgxt(): void
  queryEvaluationTerms(): Promise<EvaluationTerm[]>
  queryEvaluationResult(year?: string, term?: string): Promise<EvaluationResult>
  queryEvaluationIndicators(year?: string, term?: string): Promise<EvaluationIndicatorDetail[]>
  queryEvaluationRadar(year?: string, term?: string): Promise<EvaluationRadarItem[]>
  queryYearScoreStatics(): Promise<YearScoreStatic[]>
  queryAcademicReportYears(): Promise<AcademicReportYears>
  queryAcademicReport(year?: string): Promise<AcademicReportPage>
}

function toStr(val: unknown): string {
  if (val === null || val === undefined) return ""
  return String(val)
}

function toInt(val: unknown): number {
  const n = parseInt(toStr(val).trim(), 10)
  return Number.isNaN(n) ? 0 : n
}

function parseTerm(r: Record<string, unknown>): EvaluationTerm {
  return {
    year: toStr(r["CPXN"]),
    term: toStr(r["CPXQ"]),
    yearDisplay: toStr(r["CPXN_DISPLAY"]),
    termDisplay: toStr(r["CPXQ_DISPLAY"]),
    wid: toStr(r["WID"]),
    raw: r,
  }
}

function parseIndicator(r: Record<string, unknown>): EvaluationIndicator {
  return {
    name: toStr(r["ZBMC"]),
    score: toStr(r["FS"]),
    rank: toInt(r["RK"]),
    maxScore: toStr(r["ZDZ"]),
    category: toStr(r["ZBLB"]),
    description: toStr(r["ZBSM"]),
    raw: r,
  }
}

function parseResult(data: Record<string, unknown>): EvaluationResult {
  const zbList = data["ZBLIST"]
  return {
    totalScore: toStr(data["ZCJ"]),
    classRank: toInt(data["BJPM"]),
    classSize: toInt(data["BJRS"]),
    gradeRank: toInt(data["ZYNJPM"]),
    gradeSize: toInt(data["ZYNJRS"]),
    year: toStr(data["CPXN"]),
    term: toStr(data["CPXQ"]),
    yearDisplay: toStr(data["CPXN_DISPLAY"]),
    termDisplay: toStr(data["CPXQ_DISPLAY"]),
    showMajorRank: Boolean(data["showZypm"]),
    indicators: Array.isArray(zbList) ? zbList.filter(isPlainRecord).map(parseIndicator) : [],
    raw: data,
  }
}

function parseIndicatorDetail(r: Record<string, unknown>): EvaluationIndicatorDetail {
  return {
    name: toStr(r["ZBMC"]),
    score: toStr(r["FS"]),
    maxScore: toStr(r["ZDZ"]),
    rangeText: toStr(r["FZFW"]),
    proportion: toStr(r["BL"]),
    categoryDisplay: toStr(r["ZBLB_DISPLAY"]),
    description: toStr(r["ZBSM"]),
    raw: r,
  }
}

function parseRadarItem(r: Record<string, unknown>): EvaluationRadarItem {
  return {
    name: toStr(r["ZBMC"]),
    personal: toStr(r["GR"]),
    average: toStr(r["AVG"]),
    maxScore: toStr(r["MAX"]),
    raw: r,
  }
}

function parseYearScoreStatic(r: Record<string, unknown>): YearScoreStatic {
  return {
    year: toStr(r["XNZ"]),
    term: toStr(r["XQZ"]),
    yearDisplay: toStr(r["XNXSZ"]),
    termDisplay: toStr(r["XQXSZ"]),
    score: toStr(r["FS"]),
    raw: r,
  }
}

function parseReportYear(r: Record<string, unknown>): AcademicReportYear {
  return {
    year: toStr(r["XNZ"]),
    yearDisplay: toStr(r["XNXSZ"]),
    raw: r,
  }
}

function parseReportEntry(r: Record<string, unknown>): AcademicReportEntry {
  return {
    courseName: toStr(r["KCMC"]),
    score: toStr(r["ZCJ"]),
    credit: toStr(r["XF"]),
    courseNature: toStr(r["KCXZDM"]),
    year: toStr(r["XN"]),
    term: toStr(r["XQ"]),
    raw: r,
  }
}

export function createXGXT(ctx: YSUContext, cas: CasAuthorizer): XgxtProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  const configuredBaseUrl = ctx.config.xgxt?.baseUrl
  let xgxtJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let inflightAuth: Promise<unknown> | null = null
  let inflightReauth: Promise<void> | null = null
  let appRoleReady = false
  let inflightRole: Promise<void> | null = null
  let sessionGeneration = 0

  function getJar(): CookieJar {
    return xgxtJar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  function resetXgxt(): void {
    xgxtJar = ctx.session.createCookieJar()
    inflightAuth = null
    inflightReauth = null
    appRoleReady = false
    inflightRole = null
    sessionGeneration = 0
  }

  function baseUrl(): string {
    if (!configuredBaseUrl) {
      throw new XgxtProtocolError("xgxt base URL not configured for current school")
    }
    return configuredBaseUrl
  }

  function cookieDomain(): string {
    return new URL(baseUrl()).hostname
  }

  function zhcpServiceUrl(): string {
    return `${baseUrl().replace(/^https:/, "http:")}/xsfw/sys/zhcptybbapp/*default/index.do`
  }

  function buildApiUrl(path: string): string {
    return `${baseUrl()}/xsfw/sys/zhcptybbapp/${path}`
  }

  async function rawPost(
    url: string,
    opts?: { params?: Record<string, string>; data?: Record<string, string> }
  ): Promise<unknown> {
    const query = opts?.params ? `?${new URLSearchParams(opts.params).toString()}` : ""
    let resp: HttpResponse
    try {
      resp = await ctx.session.fetchWithJar(xgxtJar, {
        method: "POST",
        url: `${url}${query}`,
        body: new URLSearchParams(opts?.data ?? {}),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new XgxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
    }
    const text = await resp.text()
    if (resp.status === 401 || resp.status === 403) {
      throw new XgxtNotLoggedInError(`HTTP ${resp.status} from ${url}`)
    }
    if (resp.status >= 400) {
      throw new XgxtProtocolError(`HTTP ${resp.status} from ${url}`)
    }
    const contentType = headerSingle(resp.headers, "content-type") ?? ""
    if (contentType.includes("text/html") && text.includes("authserver/login")) {
      throw new XgxtNotLoggedInError("session expired, redirected to CAS login page")
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new XgxtProtocolError(`non-JSON response from ${url}: ${text.slice(0, 200)}`)
    }
  }

  async function fetchActiveRoleId(): Promise<string | null> {
    const result = await rawPost(`${baseUrl()}/xsfw/sys/swpubapp/indexmenu/getAppConfig.do`, {
      params: { appId: EMAP_APP_ID, appName: APP_NAME },
    })
    if (!isPlainRecord(result)) return null
    const header = result["HEADER"]
    const menu = isPlainRecord(header) ? header["dropMenu"] : null
    if (!Array.isArray(menu) || menu.length === 0) return null
    const active = menu.find((r) => isPlainRecord(r) && Boolean(r["active"])) ?? menu[0]
    const roleId = isPlainRecord(active) ? active["id"] : null
    if (!roleId) {
      throw new XgxtProtocolError(`getAppConfig 角色项缺少 id: ${JSON.stringify(active)}`)
    }
    return String(roleId)
  }

  async function activateRole(roleId: string): Promise<void> {
    const setResult = await rawPost(
      `${baseUrl()}/xsfw/sys/swpubapp/userinfo/setXgCommonAppRole.do`,
      {
        data: { requestParamStr: JSON.stringify({ ROLEID: roleId }) },
      }
    )
    const returnCode = isPlainRecord(setResult) ? setResult["returnCode"] : null
    if (returnCode !== "#E000000000000") {
      throw new XgxtProtocolError(`setXgCommonAppRole 响应异常: ${JSON.stringify(setResult)}`)
    }

    const changeResult = await rawPost(
      `${baseUrl()}/xsfw/sys/funauthapp/api/changeAppRole/${APP_NAME}/${roleId}.do`
    )
    const success = isPlainRecord(changeResult) ? changeResult["success"] : null
    if (success !== true) {
      throw new XgxtProtocolError(`changeAppRole 响应异常: ${JSON.stringify(changeResult)}`)
    }
  }

  async function ensureAppRole(): Promise<void> {
    if (appRoleReady) return
    if (inflightRole) {
      await inflightRole
      return
    }
    inflightRole = (async () => {
      const roleId = await fetchActiveRoleId()
      if (roleId !== null) {
        await activateRole(roleId)
      }
      appRoleReady = true
    })()
    try {
      await inflightRole
    } finally {
      inflightRole = null
    }
  }

  async function ensureAuthorized(): Promise<void> {
    await waitForAuthTransition()
    if (appRoleReady) return
    if (inflightAuth) {
      await inflightAuth
      return
    }

    const promise = withAuthTransition(async () => {
      if (appRoleReady) return

      await cas.getCredentialApplied()
      const cookies = await xgxtJar.getAllCookies()
      const hasSession = cookies.some((c) => Boolean(c.domain && c.domain.includes(cookieDomain())))
      if (!hasSession) {
        await cas.authorize(zhcpServiceUrl(), xgxtJar)
      }
      await ensureAppRole()
    })

    inflightAuth = promise
    try {
      await promise
    } finally {
      if (inflightAuth === promise) inflightAuth = null
    }
  }

  async function reauthorize(failedGeneration: number): Promise<void> {
    if (sessionGeneration !== failedGeneration) return
    if (inflightReauth) {
      await inflightReauth
      return
    }

    const promise = withAuthTransition(async () => {
      if (sessionGeneration !== failedGeneration) return

      const domain = cookieDomain()
      const cookies = await xgxtJar.getAllCookies()
      for (const c of cookies) {
        if (c.domain && c.domain.includes(domain)) {
          await xgxtJar.removeCookie(c.domain, c.path ?? "/", c.name)
        }
      }
      appRoleReady = false
      await cas.authorize(zhcpServiceUrl(), xgxtJar)
      await ensureAppRole()
      sessionGeneration += 1
    })
    inflightReauth = promise
    try {
      await promise
    } finally {
      if (inflightReauth === promise) inflightReauth = null
    }
  }

  async function post(
    path: string,
    data: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const url = buildApiUrl(path)
    let resp: HttpResponse
    try {
      resp = await ctx.session.fetchWithJar(xgxtJar, {
        method: "POST",
        url,
        body: new URLSearchParams(data),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new XgxtProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
    }
    const text = await resp.text()
    if (resp.status === 401 || resp.status === 403) {
      throw new XgxtNotLoggedInError(`HTTP ${resp.status} from ${url}`)
    }
    if (resp.status >= 400) {
      throw new XgxtProtocolError(`HTTP ${resp.status} from ${url}`)
    }
    const contentType = headerSingle(resp.headers, "content-type") ?? ""
    if (contentType.includes("text/html") && text.includes("authserver/login")) {
      throw new XgxtNotLoggedInError("session expired, redirected to CAS login page")
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new XgxtProtocolError(`non-JSON response from ${url}: ${text.slice(0, 200)}`)
    }
    if (!isPlainRecord(parsed)) {
      throw new XgxtProtocolError(`invalid JSON envelope from ${url}`)
    }
    const code = parsed["code"]
    if (code !== "0" && code !== 0) {
      const codeVal = typeof code === "string" || typeof code === "number" ? code : null
      const msgVal = typeof parsed["msg"] === "string" ? parsed["msg"] : null
      throw new XgxtBusinessError(codeVal, msgVal, url)
    }
    return parsed
  }

  async function postController(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const result = await post(path, { data: JSON.stringify(payload) })
    if (!("data" in result)) {
      throw new XgxtProtocolError(`missing 'data' field in response from ${buildApiUrl(path)}`)
    }
    return result["data"]
  }

  async function postRows(
    path: string,
    form: Record<string, string>,
    key: string
  ): Promise<{ rows: Record<string, unknown>[]; node: Record<string, unknown> }> {
    const result = await post(path, form)
    const url = buildApiUrl(path)
    const datas = result["datas"]
    if (!isPlainRecord(datas)) {
      throw new XgxtProtocolError(`missing 'datas' field in response from ${url}`)
    }
    const nodeRaw = datas[key]
    let rowsRaw: unknown
    let node: Record<string, unknown>
    if (Array.isArray(nodeRaw)) {
      rowsRaw = nodeRaw
      node = {}
    } else if (isPlainRecord(nodeRaw)) {
      node = nodeRaw
      rowsRaw = node["rows"] ?? []
    } else {
      rowsRaw = []
      node = {}
    }
    if (!Array.isArray(rowsRaw)) {
      throw new XgxtProtocolError(`'rows' is not a list in response from ${url}`)
    }
    return { rows: rowsRaw.filter(isPlainRecord), node }
  }

  async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
    await ensureAuthorized()
    const requestGeneration = sessionGeneration
    try {
      return await fn()
    } catch (e) {
      if (e instanceof XgxtNotLoggedInError) {
        await reauthorize(requestGeneration)
        await waitForAuthTransition()
        return await fn()
      }
      throw e
    }
  }

  async function queryEvaluationTerms(): Promise<EvaluationTerm[]> {
    return runWithReauth(async () => {
      const data = await postController(API_PATHS.cpxnxq, {})
      const rows = isPlainRecord(data) ? data["XNXX"] : null
      if (!Array.isArray(rows)) {
        throw new XgxtProtocolError("getCpxnxq 响应缺少 XNXX 列表")
      }
      return rows.filter(isPlainRecord).map(parseTerm)
    })
  }

  async function resolveTerm(
    year?: string,
    term?: string
  ): Promise<{ cpxn: string; cpxq: string }> {
    if (year !== undefined && term !== undefined) {
      return { cpxn: year, cpxq: term }
    }
    const terms = await queryEvaluationTerms()
    for (const t of terms) {
      if ((year === undefined || t.year === year) && (term === undefined || t.term === term)) {
        return { cpxn: t.year, cpxq: t.term }
      }
    }
    throw new XgxtProtocolError(`未找到匹配的测评学年学期: year=${year ?? ""} term=${term ?? ""}`)
  }

  async function queryEvaluationResult(year?: string, term?: string): Promise<EvaluationResult> {
    return runWithReauth(async () => {
      const { cpxn, cpxq } = await resolveTerm(year, term)
      const data = await postController(API_PATHS.cjByXn, {
        CPXN: cpxn,
        CPXQ: cpxq,
      })
      if (!isPlainRecord(data)) {
        throw new XgxtProtocolError("getEvaluationResultsByXn 响应 data 不是对象")
      }
      return parseResult(data)
    })
  }

  async function queryEvaluationIndicators(
    year?: string,
    term?: string,
    opts?: { pageSize?: number; pageNumber?: number }
  ): Promise<EvaluationIndicatorDetail[]> {
    return runWithReauth(async () => {
      const { cpxn, cpxq } = await resolveTerm(year, term)
      const { rows } = await postRows(
        API_PATHS.zbxx,
        {
          XN: cpxn,
          XQ: cpxq,
          pageSize: String(opts?.pageSize ?? 100),
          pageNumber: String(opts?.pageNumber ?? 1),
        },
        "tjsqhqxqzbxx"
      )
      return rows.map(parseIndicatorDetail)
    })
  }

  async function queryEvaluationRadar(
    year?: string,
    term?: string
  ): Promise<EvaluationRadarItem[]> {
    return runWithReauth(async () => {
      const { cpxn, cpxq } = await resolveTerm(year, term)
      const data = await postController(API_PATHS.redar, {
        CPXN: cpxn,
        CPXQ: cpxq,
      })
      if (!Array.isArray(data)) {
        throw new XgxtProtocolError("getRedar 响应 data 不是数组")
      }
      return data.filter(isPlainRecord).map(parseRadarItem)
    })
  }

  async function queryYearScoreStatics(): Promise<YearScoreStatic[]> {
    return runWithReauth(async () => {
      const data = await postController(API_PATHS.yearCjStatic, {})
      if (!Array.isArray(data)) {
        throw new XgxtProtocolError("getYearCjStatic 响应 data 不是数组")
      }
      return data.filter(isPlainRecord).map(parseYearScoreStatic)
    })
  }

  async function queryAcademicReportYears(): Promise<AcademicReportYears> {
    return runWithReauth(async () => {
      const [yearsRaw, defaultRaw] = await Promise.all([
        postController(API_PATHS.fiveYears, {}),
        postController(API_PATHS.mrXn, {}),
      ])
      return {
        years: Array.isArray(yearsRaw) ? yearsRaw.filter(isPlainRecord).map(parseReportYear) : [],
        defaultYear: isPlainRecord(defaultRaw) ? toStr(defaultRaw["DQXN"]) : "",
        raw: { fiveYears: yearsRaw, mrXn: defaultRaw },
      }
    })
  }

  async function queryAcademicReport(
    year?: string,
    opts?: { pageSize?: number; pageNumber?: number }
  ): Promise<AcademicReportPage> {
    return runWithReauth(async () => {
      let resolvedYear = year
      if (resolvedYear === undefined) {
        const defaultRaw = await postController(API_PATHS.mrXn, {})
        resolvedYear = isPlainRecord(defaultRaw) ? toStr(defaultRaw["DQXN"]) : ""
        if (!resolvedYear) {
          throw new XgxtProtocolError("getMrXn 响应缺少 DQXN 字段")
        }
      }
      const { rows, node } = await postRows(
        API_PATHS.xycjbg,
        {
          XN: resolvedYear,
          pageSize: String(opts?.pageSize ?? 100),
          pageNumber: String(opts?.pageNumber ?? 1),
        },
        "xycjbg"
      )
      return {
        entries: rows.map(parseReportEntry),
        totalSize: toInt(node["totalSize"]),
        pageNumber: toInt(node["pageNumber"]) || (opts?.pageNumber ?? 1),
        pageSize: toInt(node["pageSize"]) || (opts?.pageSize ?? 100),
        raw: node,
      }
    })
  }

  return {
    getJar,
    setTimeoutMs,
    resetXgxt,
    queryEvaluationTerms,
    queryEvaluationResult,
    queryEvaluationIndicators,
    queryEvaluationRadar,
    queryYearScoreStatics,
    queryAcademicReportYears,
    queryAcademicReport,
  }
}
