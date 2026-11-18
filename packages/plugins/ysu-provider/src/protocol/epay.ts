/**
 * 燕山大学在线综合支付平台（epay.ysu.edu.cn）—— CAS 单点登录只读模块。
 */
import type {
  CookieJar,
  EpayRecord,
  EpayRecordStatus,
  EpaySessionStatus,
} from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import { asRecord, errorMessage } from "../http-utils"
import type { CasAuthorizer } from "./cas"
import { parseLooseJson } from "./parse-json"

const BASE_URL = "https://epay.ysu.edu.cn"
const SERVICE_PATH = "/pay/allPay.html"
const ALL_PAY_PATH = "/pay/allPay.html"
const INDEX_PATH = "/pay/index.html"
const ALL_PAY_MAX_HTML = 2 * 1024 * 1024 // 2 MiB

export type { EpayRecord, EpayRecordStatus, EpaySessionStatus }

export class EpayProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EpayProtocolError"
  }
}

export class EpayNotLoggedInError extends EpayProtocolError {
  constructor(message: string) {
    super(message)
    this.name = "EpayNotLoggedInError"
  }
}

export interface EpayProtocol {
  getJar(): CookieJar
  setTimeoutMs(ms: number): void
  resetEpay(): void
  toEpayRecords(D: unknown): EpayRecord[]
  toRecordStatus(record: EpayRecord): EpayRecordStatus
  mergeRecords(...lists: EpayRecord[][]): EpayRecord[]
  toUnpaidRecords(pending: EpayRecord[]): EpayRecord[]
  getEpayStatus(): Promise<EpaySessionStatus>
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ""
  return String(v)
}

function idxOf(names: Record<string, unknown>, key: string): number | null {
  const v = names[key]
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
  return Number.isInteger(n) && n > 0 ? n - 1 : null
}

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

export function createEPAY(ctx: YSUContext, cas: CasAuthorizer): EpayProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  let epayJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let authorized = false
  let inflightAuth: Promise<void> | null = null
  let inflightStatus: Promise<EpaySessionStatus> | null = null

  function getJar(): CookieJar {
    return epayJar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  function resetEpay(): void {
    epayJar = ctx.session.createCookieJar()
    authorized = false
    inflightAuth = null
    inflightStatus = null
  }

  function assertCurrentSession(targetJar: CookieJar): void {
    if (epayJar !== targetJar) {
      throw new EpayNotLoggedInError("payment session changed during query")
    }
  }

  async function ensureAuthorized(targetJar: CookieJar): Promise<void> {
    await waitForAuthTransition()
    assertCurrentSession(targetJar)
    if (authorized) return
    if (inflightAuth) return inflightAuth

    const promise = withAuthTransition(async () => {
      assertCurrentSession(targetJar)
      if (authorized) return
      await cas.getCredentialApplied()
      assertCurrentSession(targetJar)
      await cas.authorize(`${BASE_URL}${SERVICE_PATH}`, targetJar)
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

  async function runWithReauth<T>(fn: (jar: CookieJar) => Promise<T>): Promise<T> {
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

  function isLoginPage(response: HttpResponse, text: string): boolean {
    const url = new URL(response.url)
    return (
      url.hostname !== new URL(BASE_URL).hostname ||
      /\/(?:authserver\/)?login(?:[/.]|$)/i.test(url.pathname) ||
      /<form\b[^>]*\b(?:id=["']loginForm["']|action=["'][^"']*authserver)/i.test(text) ||
      /请输入用户名|统一身份认证/.test(text)
    )
  }

  async function requestText(targetJar: CookieJar, path: string): Promise<string> {
    assertCurrentSession(targetJar)
    const url = `${BASE_URL}${path}`
    let response: HttpResponse
    try {
      response = await ctx.session.fetchWithJar(targetJar, {
        method: "GET",
        url,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      assertCurrentSession(targetJar)
      throw new EpayProtocolError(`request failed for ${url}: ${errorMessage(e)}`)
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

  function toEpayRecords(D: unknown): EpayRecord[] {
    const d = asRecord(D)
    const qr = asRecord(d.queryResult)
    const names = asRecord(qr.names)
    if (!Array.isArray(qr.rows)) {
      throw new EpayProtocolError("invalid payment records")
    }
    const rows: readonly unknown[] = qr.rows

    const records: EpayRecord[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) throw new EpayProtocolError("invalid payment row")
      const rowItems: readonly unknown[] = row
      const at = (key: string): unknown => {
        const i = idxOf(names, key)
        return i === null ? undefined : rowItems[i]
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
        if (index === null || index >= rowItems.length) {
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

  function toRecordStatus(r: EpayRecord): EpayRecordStatus {
    if (r.overTime.trim() !== "") return "paid"
    if (r.expired.trim() === "1") return "expired"
    const status = r.status.trim()
    if (status === "0") return "closed"
    if (status === "1" && r.expired.trim() === "0") return "unpaid"
    return "unknown"
  }

  async function fetchRecordsFromPage(targetJar: CookieJar, path: string): Promise<EpayRecord[]> {
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

  function mergeRecords(...lists: EpayRecord[][]): EpayRecord[] {
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

  function toUnpaidRecords(pending: EpayRecord[]): EpayRecord[] {
    return pending.filter(
      (r) => r.overTime.trim() === "" && r.status.trim() === "1" && r.expired.trim() === "0"
    )
  }

  async function getEpayStatus(): Promise<EpaySessionStatus> {
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

  return {
    getJar,
    setTimeoutMs,
    resetEpay,
    toEpayRecords,
    toRecordStatus,
    mergeRecords,
    toUnpaidRecords,
    getEpayStatus,
  }
}
