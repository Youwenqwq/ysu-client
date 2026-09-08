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
const RESPONSE_STATUS_KEYS = ["code", "status"] as const

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
let authorizationGeneration = 0

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

function assertCurrentSession(jar: SimpleCookieJar): void {
  if (jar !== ecardJar) {
    throw new EcardProtocolError("ecard session changed during request")
  }
}

// ─── Auth & low-level requests ────────────────────────────────────────── //

async function ensureAuthorized(jar: SimpleCookieJar): Promise<void> {
  await waitForAuthTransition()
  assertCurrentSession(jar)
  if (authorized) return
  await getCredentialApplied()
  assertCurrentSession(jar)
  if (inflightAuth) {
    await inflightAuth
    assertCurrentSession(jar)
    return
  }

  const promise = withAuthTransition(async () => {
    assertCurrentSession(jar)
    if (authorized) return
    await authorize(`${BASE_URL}${SERVICE_PATH}`, jar)
    assertCurrentSession(jar)
    authorizationGeneration += 1
    authorized = true
  })

  inflightAuth = promise
  try {
    await promise
  } finally {
    if (inflightAuth === promise) inflightAuth = null
  }
}

async function runWithReauth<T>(fn: (jar: SimpleCookieJar) => Promise<T>): Promise<T> {
  const jar = ecardJar
  for (let attempt = 0; ; attempt += 1) {
    await ensureAuthorized(jar)
    const requestGeneration = authorizationGeneration
    try {
      const result = await fn(jar)
      assertCurrentSession(jar)
      return result
    } catch (e) {
      assertCurrentSession(jar)
      if (!(e instanceof EcardNotLoggedInError)) throw e
      // A late failure from the previous session must not invalidate a newer authorization.
      if (requestGeneration === authorizationGeneration) authorized = false
      if (attempt > 0) throw e
    }
  }
}


// ─── Parsing helpers ──────────────────────────────────────────────────── //

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : ""
}

function parseBalance(value: unknown): number {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value.trim()))
  ) {
    throw new EcardProtocolError("invalid ecard balance")
  }
  const balance = Number(value)
  if (!Number.isFinite(balance)) throw new EcardProtocolError("invalid ecard balance")
  return balance
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
  const cardNum = str(root.cardnum ?? datas.KH ?? root.id)
  if (balanceRaw === undefined || balanceRaw === null) return null

  const months = Array.isArray(root.yearMonths)
    ? root.yearMonths.map((m) => str(m)).filter(Boolean)
    : []

  return {
    balance: parseBalance(balanceRaw),
    cardNum,
    availableDate: str(availRaw),
    cardStatusName: str(statusRaw),
    months,
  }
}

// ─── Public ───────────────────────────────────────────────────────────── //

/** 查询一卡通余额。 */
export async function getEcardBalance(): Promise<EcardSessionStatus> {
  return runWithReauth(async (jar) => {
    let resp: HttpResponse
    try {
      resp = await fetchWithJar(jar, {
        method: "POST",
        url: `${BASE_URL}${BALANCE_PATH}`,
        redirect: "manual",
        timeoutMs,
        headers: {
          Accept: "application/json, text/plain, */*",
          "X-Requested-With": "XMLHttpRequest",
        },
      })
    } catch {
      throw new EcardProtocolError("ecard request failed")
    }
    if ((resp.status >= 300 && resp.status < 400) || resp.status === 401 || resp.status === 403) {
      throw new EcardNotLoggedInError("ecard session expired")
    }
    if (resp.status < 200 || resp.status >= 300) {
      throw new EcardProtocolError(`ecard HTTP ${resp.status}`)
    }
    // Native transports can report a final URL even when manual redirects were requested.
    if (resp.url) {
      let finalUrl: URL
      try {
        finalUrl = new URL(resp.url)
      } catch {
        throw new EcardProtocolError("invalid ecard response URL")
      }
      if (finalUrl.origin !== BASE_URL || finalUrl.pathname !== BALANCE_PATH) {
        throw new EcardNotLoggedInError("ecard response left the balance endpoint")
      }
    }
    const text = await resp.text()
    if (/authserver|reAuthCheck|isMultifactor|身份认证|请输入用户名/i.test(text)) {
      throw new EcardNotLoggedInError("ecard response requires login")
    }
    let parsed: unknown
    try {
      parsed = parseLooseJson(text)
    } catch {
      throw new EcardProtocolError("non-JSON ecard response")
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new EcardProtocolError("invalid ecard response")
    }
    const body = asRecord(parsed)
    for (const key of RESPONSE_STATUS_KEYS) {
      const code = body[key]
      if (code === 401 || code === "401" || code === 403 || code === "403") {
        throw new EcardNotLoggedInError("ecard session expired")
      }
      if (code !== undefined && code !== null && code !== 200 && code !== "200") {
        throw new EcardProtocolError("ecard balance query was rejected")
      }
    }
    if (body.success === false) throw new EcardProtocolError("ecard balance query was rejected")
    if (
      !("datas" in body) &&
      !("remining" in body) &&
      str(body.code) !== "200" &&
      str(body.status) !== "200"
    ) {
      throw new EcardProtocolError("unrecognized ecard response")
    }
    return { ready: true, balance: toEcardBalance(body) }
  })
}