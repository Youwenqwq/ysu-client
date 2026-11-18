/**
 * ehall 一卡通余额 —— CAS 单点登录只读模块。
 */
import type { CookieJar, EcardBalance, EcardSessionStatus } from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import { asRecord, isPlainRecord } from "../http-utils"
import type { CasAuthorizer } from "./cas"
import { parseLooseJson } from "./parse-json"

const BASE_URL = "https://ehall.ysu.edu.cn"
const SERVICE_PATH = "/publicapp/sys/myyktzd/index.do"
const BALANCE_PATH = "/publicapp/sys/myyktzd/mySmartCard/loadSmartCardBillMain.do"
const RESPONSE_STATUS_KEYS = ["code", "status"] as const

export type { EcardBalance, EcardSessionStatus }

export class EcardProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EcardProtocolError"
  }
}

export class EcardNotLoggedInError extends EcardProtocolError {
  constructor(message: string) {
    super(message)
    this.name = "EcardNotLoggedInError"
  }
}

export interface EcardProtocol {
  getJar(): CookieJar
  setTimeoutMs(ms: number): void
  resetEcard(): void
  toEcardBalance(body: unknown): EcardBalance | null
  getEcardBalance(): Promise<EcardSessionStatus>
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

export function createECARD(ctx: YSUContext, cas: CasAuthorizer): EcardProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  let ecardJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let authorized = false
  let inflightAuth: Promise<void> | null = null
  let authorizationGeneration = 0

  function getJar(): CookieJar {
    return ecardJar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  function resetEcard(): void {
    ecardJar = ctx.session.createCookieJar()
    authorized = false
    inflightAuth = null
  }

  function assertCurrentSession(jar: CookieJar): void {
    if (jar !== ecardJar) {
      throw new EcardProtocolError("ecard session changed during request")
    }
  }

  async function ensureAuthorized(jar: CookieJar): Promise<void> {
    await waitForAuthTransition()
    assertCurrentSession(jar)
    if (authorized) return
    await cas.getCredentialApplied()
    assertCurrentSession(jar)
    if (inflightAuth) {
      await inflightAuth
      assertCurrentSession(jar)
      return
    }

    const promise = withAuthTransition(async () => {
      assertCurrentSession(jar)
      if (authorized) return
      await cas.authorize(`${BASE_URL}${SERVICE_PATH}`, jar)
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

  async function runWithReauth<T>(fn: (jar: CookieJar) => Promise<T>): Promise<T> {
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
        if (requestGeneration === authorizationGeneration) authorized = false
        if (attempt > 0) throw e
      }
    }
  }

  function toEcardBalance(body: unknown): EcardBalance | null {
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

  async function getEcardBalance(): Promise<EcardSessionStatus> {
    return runWithReauth(async (jar) => {
      let resp: HttpResponse
      try {
        resp = await ctx.session.fetchWithJar(jar, {
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
      if (!isPlainRecord(parsed)) {
        throw new EcardProtocolError("invalid ecard response")
      }
      const body = parsed
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

  return {
    getJar,
    setTimeoutMs,
    resetEcard,
    toEcardBalance,
    getEcardBalance,
  }
}
