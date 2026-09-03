/**
 * ehall 一卡通余额 —— CAS 单点登录只读模块。
 *
 * 与 elpay 同模式：复用教务 CAS 会话，用 authorize() 免密换取 ehall 会话
 * （service = /publicapp/sys/myyktzd/index.do），再调余额接口。
 */
import { SimpleCookieJar, fetchWithJar, parseLooseJson, type HttpResponse } from "@/lib/cookie"
import { authorize, getCredentialApplied } from "./cas"
import { waitForAuthTransition, withAuthTransition } from "../auth-transition"

// ─── Constants ────────────────────────────────────────────────────────── //

/** ehall 服务根。 */
const BASE_URL = "https://ehall.ysu.edu.cn"
/** CAS 单点登录的 service（myyktzd 一卡通应用入口）。 */
const SERVICE_PATH = "/publicapp/sys/myyktzd/index.do"
/** 一卡通账单主数据（含余额）。 */
const BALANCE_PATH = "/publicapp/sys/myyktzd/mySmartCard/loadSmartCardBillMain.do"

// ─── Types ────────────────────────────────────────────────────────────── //

/** 一卡通余额信息。 */
export interface EcardBalance {
  /** 余额（元） */
  balance: number
  /** 卡号 */
  cardNum: string
  /** 有效期 "2029-08-31" */
  availableDate: string
  /** 卡状态名（如 在用） */
  cardStatusName: string
  /** 可用月份（如 ["2026-09","2026-08"]） */
  months: string[]
}

export interface EcardSessionStatus {
  ready: boolean
  /** 余额；无则 null */
  balance: EcardBalance | null
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class EcardProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EcardProtocolError"
  }
}

/** 会话未认证/过期。 */
export class EcardNotLoggedInError extends EcardProtocolError {
  constructor(message: string) {
    super(message)
    this.name = "EcardNotLoggedInError"
  }
}

// ─── Module state ─────────────────────────────────────────────────────── //

let ecardJar = new SimpleCookieJar()
let timeoutMs = 30_000
let authorized = false
let inflightAuth: Promise<void> | null = null

export function getJar(): SimpleCookieJar {
  return ecardJar
}

export function setTimeoutMs(ms: number): void {
  timeoutMs = ms
}

export function resetEcard(): void {
  ecardJar = new SimpleCookieJar()
  authorized = false
  inflightAuth = null
}

function repr(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

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
    await authorize(`${BASE_URL}${SERVICE_PATH}`, ecardJar)
    authorized = true
  })

  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

async function runWithReauth<T>(fn: () => Promise<T>): Promise<T> {
  await ensureAuthorized()
  try {
    return await fn()
  } catch (e) {
    if (e instanceof EcardNotLoggedInError) {
      authorized = false
      await ensureAuthorized()
      await waitForAuthTransition()
      return await fn()
    }
    throw e
  }
}

function isLoginPage(text: string): boolean {
  const t = text.slice(0, 600)
  return /authserver|身份认证|请输入用户名/.test(t)
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

/**
 * 解析 loadSmartCardBillMain.do 返回的余额结构。
 * 顶层 remining/availdate/cardstatusname 或 datas.KNYE/KYXQ/MC。
 */
export function toEcardBalance(body: unknown): EcardBalance | null {
  const root = asRecord(body)
  const datas = asRecord(root.datas)

  const balanceRaw = root.remining ?? datas.KNYE
  const availRaw = root.availdate ?? datas.KYXQ
  const statusRaw = root.cardstatusname ?? datas.MC
  const cardNum = str(root.cardnum ?? root.id ?? datas.KH)
  if (balanceRaw === undefined && availRaw === undefined) return null

  const months = Array.isArray(root.yearMonths)
    ? root.yearMonths.map((m) => str(m)).filter(Boolean)
    : []

  return {
    balance: num(balanceRaw),
    cardNum,
    availableDate: str(availRaw),
    cardStatusName: str(statusRaw),
    months,
  }
}

// ─── Public ───────────────────────────────────────────────────────────── //

/** 查询一卡通余额。 */
export async function getEcardBalance(): Promise<EcardSessionStatus> {
  return runWithReauth(async () => {
    const url = `${BASE_URL}${BALANCE_PATH}`
    let resp: HttpResponse
    try {
      resp = await fetchWithJar(ecardJar, {
        method: "POST",
        url,
        redirect: "follow",
        timeoutMs,
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
      })
    } catch (e) {
      throw new EcardProtocolError(`request failed for ${url}: ${repr(e)}`)
    }
    // 校验最终落地 URL：跟随重定向后必须仍落在 ehall API 域（防被踢回登录/外部域）。
    // resp.url 在部分运行时（CapacitorHttp）可能为空，空值不误判，交由响应体检查兜底。
    if (resp.url && (!resp.url.startsWith(BASE_URL) || isLoginPage(resp.url))) {
      throw new EcardNotLoggedInError(`redirected away from API: ${resp.url}`)
    }
    const text = await resp.text()
    if (isLoginPage(text)) {
      throw new EcardNotLoggedInError(`redirected to login page: ${url}`)
    }
    if (resp.status >= 400) {
      throw new EcardProtocolError(`HTTP ${resp.status} from ${url}`)
    }
    let parsed: unknown
    try {
      parsed = parseLooseJson(text)
    } catch {
      throw new EcardProtocolError(`non-JSON response from ${url}`)
    }
    return { ready: true, balance: toEcardBalance(parsed) }
  })
}