/**
 * 燕山大学在线综合支付平台（epay.ysu.edu.cn）—— CAS 单点登录只读模块。
 *
 * 与 ldxt/scxt/xgxt 同一模式：复用教务 CAS 会话，用 authorize() 免密换取
 * epay 会话（service = /pay/allPay.html）。不触碰支付流程，仅查付款状态。
 *
 * 接口返回"宽松 JSON"（key 不带引号），用 parseLooseJson 处理。
 */
import { SimpleCookieJar, fetchWithJar, parseLooseJson, type HttpResponse } from "@/lib/cookie"
import { authorize, getCredentialApplied } from "./cas"
import { waitForAuthTransition, withAuthTransition } from "../auth-transition"

// ─── Constants ────────────────────────────────────────────────────────── //

/** elpay 服务根。 */
const BASE_URL = "https://epay.ysu.edu.cn"
/** CAS 单点登录的 service（authorize 的授权目标，登录后落地 allPay 页）。 */
const SERVICE_PATH = "/pay/allPay.html"
/** 付款记录页（已缴/全量历史；默认 payStatus=all=已支付，eterna 数据内联在 $E.D）。 */
const ALL_PAY_PATH = "/pay/allPay.html"
/** 我的待付款页（仅列待缴/未支付记录；与 allPay 互补，二者合并去重即可互相印证）。 */
const INDEX_PATH = "/pay/index.html"

// ─── Types ────────────────────────────────────────────────────────────── //


/** 一条付款记录（queryResult.rows 行）。 */
export interface EpayRecord {
  /** 记录 ID */
  id: string
  /** 收费名称，如 "2026年住宿费缴费 " */
  payName: string
  /** 收费年度，如 "2026年" */
  chargeYear: string
  /** 币种展示 */
  currencyTypeShow: string
  /** 金额（元，数字） */
  amountN: number
  /** 金额（带千分位显示，如 "10,000.00"） */
  amount: string
  /** 已付金额（数字字符串） */
  payAmount: string
  /** 退款金额 */
  refundAmount: string
  /** 状态（1=有效，0=关闭） */
  status: string
  /** 是否过期（1=已过期） */
  expired: string
  /** 开始时间 "2026-09-01" */
  startTime: string
  /** 付款完成时间 "2026-09-01 11:05:16"；空=未支付 */
  overTime: string
}

/** 付款状态归一化。 */
export type EpayRecordStatus = "paid" | "unpaid" | "closed" | "expired" | "unknown"

export interface EpaySessionStatus {
  /** 是否有有效会话（能取到数据） */
  ready: boolean
  /** 全部付款记录（登录态；allPay 已缴历史 + index 待缴，按 id 合并） */
  records: EpayRecord[]
  /**
   * 待缴记录（真正需要缴费的）—— 只来自"我的待付款"(index) 源，
   * 判定 overTime 为空 && status=1 && expired=0，与官方页面口径一致。
   * allPay 记录里无 overTime 的（已过期/已关闭）不在此列。
   */
  unpaid: EpayRecord[]
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class EpayProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EpayProtocolError"
  }
}

/** 会话未认证/过期（请求被重定向回 CAS 登录页）。 */
export class EpayNotLoggedInError extends EpayProtocolError {
  constructor(message: string) {
    super(message)
    this.name = "EpayNotLoggedInError"
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let epayJar = new SimpleCookieJar()
let timeoutMs = 30_000
let authorized = false
let inflightAuth: Promise<void> | null = null
let inflightStatus: Promise<EpaySessionStatus> | null = null

export function getJar(): SimpleCookieJar {
  return epayJar
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms
}

export function resetEpay(): void {
  epayJar = new SimpleCookieJar()
  authorized = false
  inflightAuth = null
  inflightStatus = null
}

function repr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

/**
 * 懒认证：用 CAS session 换取 epay 会话。
 * 授权即 GET /pay/allPay.html（service），成功后 epayJar 即持有有效会话。
 */
async function ensureAuthorized(targetJar: SimpleCookieJar): Promise<void> {
  await waitForAuthTransition()
  assertCurrentSession(targetJar)
  if (authorized) return
  if (inflightAuth) return inflightAuth

  const promise = withAuthTransition(async () => {
    assertCurrentSession(targetJar)
    if (authorized) return
    await getCredentialApplied()
    assertCurrentSession(targetJar)
    await authorize(`${BASE_URL}${SERVICE_PATH}`, targetJar)
    assertCurrentSession(targetJar)
    authorized = true
  })
  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

function assertCurrentSession(targetJar: SimpleCookieJar): void {
  if (epayJar !== targetJar) {
    throw new EpayNotLoggedInError("payment session changed during query")
  }
}

/** 会话过期时重新认证一次并重试（与 jwxt runWithReauth 同一模式）。 */
async function runWithReauth<T>(fn: (jar: SimpleCookieJar) => Promise<T>): Promise<T> {
  const targetJar = epayJar
  await ensureAuthorized(targetJar)
  try {
    return await fn(targetJar)
  } catch (e) {
    assertCurrentSession(targetJar)
    if (e instanceof EpayNotLoggedInError) {
      authorized = false
      await ensureAuthorized(targetJar)
      return await fn(targetJar)
    }
    throw e
  }
}

/** 是否为 elpay 的登录页（CAS 认证入口）HTML。 */
function isLoginPage(response: HttpResponse, text: string): boolean {
  const url = new URL(response.url)
  return (
    url.hostname !== new URL(BASE_URL).hostname ||
    /\/(?:authserver\/)?login(?:[/.]|$)/i.test(url.pathname) ||
    /<form\b[^>]*\b(?:id=["']loginForm["']|action=["'][^"']*authserver)/i.test(text) ||
    /请输入用户名|统一身份认证/.test(text)
  )
}

/** 共用只读传输和会话失效判定，所有请求绑定查询开始时的 jar。 */
async function requestText(targetJar: SimpleCookieJar, path: string): Promise<string> {
  assertCurrentSession(targetJar)
  const url = `${BASE_URL}${path}`
  let response: HttpResponse
  try {
    response = await fetchWithJar(targetJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    assertCurrentSession(targetJar)
    throw new EpayProtocolError(`request failed for ${url}: ${repr(e)}`)
  }
  const text = await response.text()
  assertCurrentSession(targetJar)
  if (response.status === 401 || isLoginPage(response, text)) {
    throw new EpayNotLoggedInError(`redirected to login page: ${url}`)
  }
  if (response.status < 200 || response.status >= 300) {
    throw new EpayProtocolError(`HTTP ${response.status} from ${url}`)
  }
  return text
}


// ─── Parsing helpers ──────────────────────────────────────────────────── //

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}


/** names 的 value 是 1 基，转 JS 0 基数组下标 */
function idxOf(names: Record<string, unknown>, key: string): number | null {
  const v = names[key]
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n - 1 : null
}

/**
 * 从 eterna $E.D（D 对象）解析 queryResult 全部付款记录。
 * body 为 /pay/allPay.html 内 `var $E={G:...,D:{...},...}` 里 D 的对象值。
 */
export function toEpayRecords(D: unknown): EpayRecord[] {
  const d = asRecord(D)
  const qr = asRecord(d.queryResult)
  const names = asRecord(qr.names)
  if (!Array.isArray(qr.rows)) {
    throw new EpayProtocolError("invalid payment records")
  }
  const rows = qr.rows

  const records: EpayRecord[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) throw new EpayProtocolError("invalid payment row")
    const at = (key: string): unknown => {
      const i = idxOf(names, key)
      return i === null ? undefined : (row as unknown[])[i]
    }
    const payName = str(at("payName"))
    const id = str(at("id")).trim()
    const amountValue = at("amountN")
    const amountN = Number(amountValue)
    if (
      !id ||
      !payName.trim() ||
      (typeof amountValue !== "number" && typeof amountValue !== "string") ||
      str(amountValue).trim() === "" ||
      !Number.isFinite(amountN)
    ) {
      throw new EpayProtocolError("invalid payment identity or amount")
    }
    for (const key of ["status", "expired", "overTime"]) {
      const index = idxOf(names, key)
      if (index === null || index >= row.length) {
        throw new EpayProtocolError(`missing payment field: ${key}`)
      }
    }
    records.push({
      id,
      payName,
      chargeYear: str(at("chargeYear")),
      currencyTypeShow: str(at("currencyTypeShow")),
      amountN,
      amount: str(at("amount")),
      payAmount: str(at("payAmount")),
      refundAmount: str(at("refundAmount")),
      status: str(at("status")),
      expired: str(at("expired")),
      startTime: str(at("startTime")),
      overTime: str(at("overTime")),
    })
  }
  return records
}

/** 从行数据归一化支付状态。 */
export function toRecordStatus(r: EpayRecord): EpayRecordStatus {
  if (r.overTime.trim() !== "") return "paid"
  if (r.expired.trim() === "1") return "expired"
  const status = r.status.trim()
  if (status === "0") return "closed"
  if (status === "1" && r.expired.trim() === "0") return "unpaid"
  return "unknown"
}


// ─── Public: 付款状态 ─────────────────────────────────────────────────── //

/**
 * 从 allPay.html 的 HTML 里抽取 eterna $E.D 对象值（D:{...}）。
 * 通过匹配 `D:{` 后的花括号配对找到 D 对象字面量边界。
 *
 * 加固：限制页面大小，防止超大 HTML 导致的解析压力。
 */
const ALL_PAY_MAX_HTML = 2 * 1024 * 1024 // 2 MiB

function extractDObject(html: string): Record<string, unknown> | null {
  if (html.length > ALL_PAY_MAX_HTML) return null
  const marker = /\bD\s*:\s*\{/.exec(html)
  if (!marker) return null
  const start = marker.index + marker[0].lastIndexOf("{")
  let depth = 0
  let quote = ""
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!
    if (quote) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === quote) quote = ""
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === "{") depth++
    else if (ch === "}" && --depth === 0) {
      try {
        return asRecord(parseLooseJson(html.slice(start, i + 1)))
      } catch {
        return null
      }
    }
  }
  return null
}

/** 登录后抓指定页面（allPay/index）里的付款记录，解出其 D 对象里的 queryResult。 */
async function fetchRecordsFromPage(
  targetJar: SimpleCookieJar,
  path: string
): Promise<EpayRecord[]> {
  const text = await requestText(targetJar, path)
  const D = extractDObject(text)
  const queryResult = asRecord(D?.queryResult)
  if (!Array.isArray(queryResult.rows)) {
    throw new EpayProtocolError(`invalid payment response from ${BASE_URL}${path}`)
  }
  if (queryResult.hasNextPage === true || str(queryResult.hasNextPage) === "1") {
    throw new EpayProtocolError("payment response contains additional pages")
  }
  return toEpayRecords(D)
}


/**
 * 合并两个数据源并按记录 id 去重。
 * allPay（已缴历史）与 index（待缴）互补；同一笔单不会同时出现在两边，
 * 但去重保险，避免边界情况重复展示。
 */
export function mergeRecords(...lists: EpayRecord[][]): EpayRecord[] {
  const seen = new Set<string>()
  const merged: EpayRecord[] = []
  for (const list of lists) {
    for (const r of list) {
      if (!r.id) continue
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(r)
    }
  }
  return merged
}

/**
 * 从"我的待付款"(index) 记录中筛出待缴项。
 * 判定与官方页面一致：overTime 为空 && status=1 && expired=0。
 * allPay 记录（含已过期/已关闭的未支付历史）不参与待缴判定。
 */
export function toUnpaidRecords(pending: EpayRecord[]): EpayRecord[] {
  return pending.filter(
    (r) => r.overTime.trim() === "" && r.status.trim() === "1" && r.expired.trim() === "0"
  )
}

/** 查询当前会话的付款状态（全部记录 = allPay 已缴 + index 待缴；待缴只以 index 为准）。 */
export async function getEpayStatus(): Promise<EpaySessionStatus> {
  if (inflightStatus) return inflightStatus
  const promise = runWithReauth(async (targetJar) => {
    const history = await fetchRecordsFromPage(targetJar, ALL_PAY_PATH)
    const pending = await fetchRecordsFromPage(targetJar, INDEX_PATH)
    const records = mergeRecords(pending, history)
    const unpaid = toUnpaidRecords(mergeRecords(pending))
    assertCurrentSession(targetJar)
    return { ready: true, records, unpaid }
  })
  inflightStatus = promise
  try {
    return await promise
  } finally {
    if (inflightStatus === promise) inflightStatus = null
  }
}
