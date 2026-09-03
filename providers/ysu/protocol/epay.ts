/**
 * 燕山大学在线综合支付平台（epay.ysu.edu.cn）—— CAS 单点登录只读模块。
 *
 * 与 ldxt/scxt/xgxt 同一模式：复用教务 CAS 会话，用 authorize() 免密换取
 * epay 会话（service = /pay/allPay.html）。不触碰支付流程，仅查付款状态。
 *
 * 接口返回"宽松 JSON"（key 不带引号），用 parseLooseJson 处理。
 */
import { SimpleCookieJar, fetchWithJar, parseLooseJson, type HttpResponse } from "@/lib/cookie"
import { authorize, getCredentialApplied, isAuthenticated } from "./cas"
import { waitForAuthTransition, withAuthTransition } from "../auth-transition"

// ─── Constants ────────────────────────────────────────────────────────── //

/** elpay 服务根。 */
const BASE_URL = "https://epay.ysu.edu.cn"
/** CAS 单点登录的 service（authorize 的授权目标，登录后落地 allPay 页）。 */
const SERVICE_PATH = "/pay/allPay.html"
/** 最近一笔付款（登录后 JSON 接口）。 */
const LAST_PAY_PATH = "pay/lastPay.info.ajax.html"
/** 付款记录页（已缴/全量历史；默认 payStatus=all=已支付，eterna 数据内联在 $E.D）。 */
const ALL_PAY_PATH = "/pay/allPay.html"
/** 我的待付款页（仅列待缴/未支付记录；与 allPay 互补，二者合并去重即可互相印证）。 */
const INDEX_PATH = "/pay/index.html"

// ─── Types ────────────────────────────────────────────────────────────── //

export interface EpayLastPay {
  /** 金额（元，字符串，如 "870.00"） */
  amount: string
  /** 记录 ID */
  rid: string
  /** 付款时间 "2026-09-01 11:05:16" */
  payTime: string
  /** 项目名，如 "2026年住宿费缴费" */
  payName: string
  /** 币种展示，如 "人民币元[CNY]" */
  currencyTypeShow: string
}

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
  /** 最近一笔付款；无则 null */
  lastPay: EpayLastPay | null
  /** 全部付款记录（登录态） */
  records: EpayRecord[]
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
}

function repr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

/**
 * 懒认证：用 CAS session 换取 epay 会话。
 * 授权即 GET /pay/allPay.html（service），成功后 epayJar 即持有有效会话。
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
    await authorize(`${BASE_URL}${SERVICE_PATH}`, epayJar)
    if (!(await isAuthenticated())) {
      throw new EpayNotLoggedInError("CAS session is not authenticated")
    }
    authorized = true
  })

  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

/** 会话过期时重新认证一次并重试（与 jwxt runWithReauth 同一模式）。 */
async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EpayNotLoggedInError) {
      authorized = false
      await ensureAuthorized()
      await waitForAuthTransition()
      return await fn()
    }
    throw e
  }
}

/** 是否为 elpay 的登录页（CAS 认证入口）HTML。 */
function isLoginPage(text: string): boolean {
  const t = text.slice(0, 600)
  return /authserver|身份认证|请输入用户名/.test(t)
}

/**
 * 调用 elpay 的一个 JSON 接口。若响应是登录页 HTML 则抛 EpayNotLoggedInError。
 * 返回宽松 JSON 解析后的对象。
 */
async function callJson(
  path: string,
  params?: Record<string, string | number>
): Promise<Record<string, unknown>> {
  const query = params
    ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    : ""
  const url = `${BASE_URL}/${path}${query}`
  let resp: HttpResponse
  try {
    resp = await fetchWithJar(epayJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
      headers: { Accept: "application/json, text/plain, */*" },
    })
  } catch (e) {
    throw new EpayProtocolError(`request failed for ${url}: ${repr(e)}`)
  }
  const text = await resp.text()
  if (isLoginPage(text)) {
    throw new EpayNotLoggedInError(`redirected to login page: ${url}`)
  }
  if (resp.status >= 400) {
    throw new EpayProtocolError(`HTTP ${resp.status} from ${url}`)
  }
  try {
    return parseLooseJson(text) as Record<string, unknown>
  } catch {
    throw new EpayProtocolError(`non-JSON response from ${url}`)
  }
}

// ─── Parsing helpers ──────────────────────────────────────────────────── //

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
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
  const rows = Array.isArray(qr.rows) ? qr.rows : []

  const records: EpayRecord[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const at = (key: string): unknown => {
      const i = idxOf(names, key)
      return i === null ? undefined : (row as unknown[])[i]
    }
    const payName = str(at("payName"))
    records.push({
      id: str(at("id")),
      payName,
      chargeYear: str(at("chargeYear")),
      currencyTypeShow: str(at("currencyTypeShow")),
      amountN: num(at("amountN")),
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
  if (status === "1") return "unpaid"
  return "unknown"
}

/**
 * 从 {D:{lastPay:{...}}} 提取最近一笔付款。
 */
export function toLastPay(body: unknown): EpayLastPay | null {
  const D = asRecord(body).D as unknown
  const lp = asRecord(D).lastPay as unknown
  if (!lp || typeof lp !== "object") return null
  const l = asRecord(lp)
  const payName = str(l.payName)
  if (!payName && !str(l.payTime)) return null
  return {
    amount: str(l.amount),
    rid: str(l.rid),
    payTime: str(l.payTime),
    payName,
    currencyTypeShow: str(l.currencyTypeShow) || str(l.currencyType) || "人民币元[CNY]",
  }
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
  if (typeof html !== "string" || html.length > ALL_PAY_MAX_HTML) return null
  const start = html.indexOf("D:{")
  if (start < 0) return null
  let i = start + 2 // 跳过 "D:"
  let depth = 0
  let inStr = false
  let ch
  let scanCount = 0
  for (; i < html.length; i++) {
    // 加固：超过上限字符仍未配对成功则放弃，防恶意超长输入
    if (++scanCount > ALL_PAY_MAX_HTML) return null
    ch = html[i]
    if (ch === '"' && html[i - 1] !== "\\") inStr = !inStr
    if (inStr) continue
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        const raw = html.slice(start + 2, i + 1)
        try {
          return parseLooseJson(raw) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/** 登录后抓指定页面（allPay/index）里的付款记录，解出其 D 对象里的 queryResult。 */
async function fetchRecordsFromPage(path: string): Promise<EpayRecord[]> {
  const url = `${BASE_URL}${path}`
  let resp: HttpResponse
  try {
    resp = await fetchWithJar(epayJar, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    throw new EpayProtocolError(`request failed for ${url}: ${repr(e)}`)
  }
  const text = await resp.text()
  if (isLoginPage(text)) {
    throw new EpayNotLoggedInError(`redirected to login page: ${url}`)
  }
  if (resp.status >= 400) {
    throw new EpayProtocolError(`HTTP ${resp.status} from ${url}`)
  }
  const D = extractDObject(text)
  const queryResult = D ? asRecord(D).queryResult : null
  if (
    queryResult === null ||
    typeof queryResult !== "object" ||
    !Array.isArray(asRecord(queryResult).rows)
  ) {
    throw new EpayProtocolError(`invalid allPay response from ${url}`)
  }
  return toEpayRecords(D)
}

/** 抓付款记录页（默认已支付历史）。 */
async function fetchAllRecords(): Promise<EpayRecord[]> {
  return fetchRecordsFromPage(ALL_PAY_PATH)
}

/** 抓"我的待付款"页（未支付/待缴记录）。 */
async function fetchPendingRecords(): Promise<EpayRecord[]> {
  return fetchRecordsFromPage(INDEX_PATH)
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

/** 查询当前会话的付款状态（全部记录 = allPay 已缴 + index 待缴，互相印证 + 最近一笔）。 */
export async function getEpayStatus(): Promise<EpaySessionStatus> {
  return runWithReauth(async () => {
    // 串行抓两个源：共用 epayJar，并发时 reauth 可能互相干扰
    const history = await fetchAllRecords()
    const pending = await fetchPendingRecords()
    const records = mergeRecords(history, pending)
    let lastPay: EpayLastPay | null = null
    try {
      const body = await callJson(LAST_PAY_PATH)
      lastPay = toLastPay(body)
    } catch (e) {
      if (e instanceof EpayNotLoggedInError) throw e
      // 最近一笔付款是附加信息，接口异常不影响全部记录结果。
    }
    return { ready: true, lastPay, records }
  })
}
