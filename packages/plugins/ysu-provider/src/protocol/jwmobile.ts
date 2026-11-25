/**
 * jwmobile API 模块 —— 独立 mobile biz 接口。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import {
  collectCookies,
  cookieEntryFromJSON,
  headerSingle,
  installCookies,
  type CookieEntry,
} from "@orahako/sdk"
import type { YSUContext } from "../context"
import { asRecord, isPlainRecord } from "../http-utils"
import { YSU_SESSION_ARTIFACT_MOBILE } from "../ysu-config"
import type { CasAuthorizer } from "./cas"

const DEFAULT_TIMEOUT_MS = 30_000
const MOBILE_REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

export interface LessonActivity {
  readonly activityId: string
  readonly type: number | null
  readonly status: number | null
  readonly title: string | null
  readonly icon: string | null
  readonly signType: string | null
  readonly signClazz: string | null
  readonly isEnd: boolean
  readonly isCreator: boolean
  readonly createTime: string | null
  readonly createAt?: string
  readonly createTimestamp?: number
  readonly raw: Record<string, unknown>
}

export interface CurrentLesson {
  readonly lessonId: string | null
  readonly activityList: readonly LessonActivity[]
  readonly raw: Record<string, unknown>
}

export interface SigninActivityDetail {
  readonly activityId: string
  readonly duration: number
  readonly endTime: string
  readonly endAt?: string
  readonly endTimestamp?: number
  readonly leftSeconds: number
  readonly signinType: number
  readonly startTime: string
  readonly startAt?: string
  readonly startTimestamp?: number
  readonly raw: Record<string, unknown>
}

export interface StudentSigninStatus {
  readonly signStatus: number
  readonly attendanceStatus: number
  readonly signOrder: number
  readonly signinType: number
  readonly raw: Record<string, unknown>
}

export interface StudentSignResult {
  readonly signStatus: number
  readonly attendanceStatus: number
  readonly signOrder: number
  readonly signinType: number
  readonly raw: Record<string, unknown>
}

export class MobileError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = "MobileError"
  }
}

export class MobileNotLoggedInError extends MobileError {
  constructor(message?: string) {
    super(message)
    this.name = "MobileNotLoggedInError"
  }
}

export class MobileProtocolError extends MobileError {
  constructor(message?: string) {
    super(message)
    this.name = "MobileProtocolError"
  }
}

export class MobileBusinessError extends MobileError {
  readonly code: string | number | null
  readonly msg: string | null
  readonly url: string

  constructor(code: string | number | null, msg: string | null, url: string) {
    super(`Mobile business error from ${url}: code=${code} msg=${msg}`)
    this.name = "MobileBusinessError"
    this.code = code
    this.msg = msg
    this.url = url
  }
}

function isMobileCookie(e: CookieEntry, cookieDomain: string): boolean {
  return e.domain.length > 0 && e.domain.includes(cookieDomain)
}

export class MobileSession {
  constructor(public readonly cookies: readonly CookieEntry[]) {}

  static async fromJar(jar: CookieJar, cookieDomain: string): Promise<MobileSession> {
    return new MobileSession(await collectCookies(jar, (e) => isMobileCookie(e, cookieDomain)))
  }

  async apply(jar: CookieJar): Promise<void> {
    await installCookies(jar, this.cookies)
  }

  isEmpty(): boolean {
    return this.cookies.length === 0
  }

  toJSON(): string {
    return JSON.stringify({ cookies: this.cookies.map((c) => ({ ...c })) })
  }

  static fromJSON(s: string): MobileSession {
    const data: unknown = JSON.parse(s)
    if (!isPlainRecord(data) || !("cookies" in data)) {
      throw new Error("invalid MobileSession JSON: missing 'cookies'")
    }
    const rawCookies = data.cookies
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid MobileSession JSON: 'cookies' must be a list")
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (!isPlainRecord(item)) {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`)
      }
      return cookieEntryFromJSON(item)
    })
    return new MobileSession(entries)
  }
}

export interface JWMobileProtocol {
  getJar(): CookieJar
  setJar(jar: CookieJar): void
  setTimeoutMs(ms: number): void
  restoreSession(session: MobileSession): Promise<void>
  resetMobileAuth(): void
  ensureMobileAuthorized(verify?: boolean): Promise<void>
  queryCurrentLesson(params: {
    teachClassId: string
    teachClassType: string
    scheduleId: string
    week: number
    weekDay: number
    startNode: number
    endNode: number
  }): Promise<CurrentLesson>
  querySigninDetail(params: { activityId: string; title?: string }): Promise<SigninActivityDetail>
  queryStudentSigninStatus(params: {
    activityId: string
    title?: string
  }): Promise<StudentSigninStatus>
  studentSign(params: {
    activityId: string
    accuracy?: number
    latitude?: number
    longitude?: number
    code?: string
  }): Promise<StudentSignResult>
}

function rawStr(raw: Record<string, unknown>, ...keys: readonly string[]): string {
  for (const k of keys) {
    const v = raw[k]
    if (v !== undefined && v !== null && v !== "" && v !== 0 && v !== false) {
      return String(v)
    }
  }
  return ""
}

function rawNum(raw: Record<string, unknown>, ...keys: readonly string[]): number {
  for (const k of keys) {
    const v = raw[k]
    if (v === undefined || v === null || v === "") continue
    const n = typeof v === "number" ? v : Number(v)
    if (Number.isFinite(n) && n !== 0) return n
  }
  for (const k of keys) {
    const v = raw[k]
    if (v === undefined || v === null || v === "") continue
    const n = typeof v === "number" ? v : Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function rawInt(raw: Record<string, unknown>, ...keys: readonly string[]): number {
  return Math.trunc(rawNum(raw, ...keys))
}

function normalizeLocalDateTime(value: string | null): string | undefined {
  if (!value) return undefined
  const text = value.trim()
  const match = text.match(
    /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2}).*?(\d{1,2}):(\d{2})(?::(\d{2}))?/
  )
  if (!match) return undefined
  const [, year, month, day, hour, minute, second = "00"] = match
  return `${year!}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}T${hour!.padStart(2, "0")}:${minute!}:${second}`
}

function localDateTimeTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function parseLessonActivity(raw: Record<string, unknown>): LessonActivity {
  const typeRaw = raw["type"]
  const statusRaw = raw["status"]
  const titleRaw = raw["title"]
  const iconRaw = raw["icon"]
  const createTime = raw["createTime"] == null ? null : rawStr(raw, "createTime")
  const createAt = normalizeLocalDateTime(createTime)
  return {
    activityId: rawStr(raw, "activityId"),
    type: typeRaw == null ? null : rawInt(raw, "type"),
    status: statusRaw == null ? null : rawInt(raw, "status"),
    title: titleRaw == null ? null : rawStr(raw, "title"),
    icon: iconRaw == null ? null : rawStr(raw, "icon"),
    signType: rawStr(raw, "signType"),
    signClazz: rawStr(raw, "signClazz"),
    isEnd: Boolean(raw["isEnd"]),
    isCreator: Boolean(raw["isCreator"]),
    createTime,
    createAt,
    createTimestamp: localDateTimeTimestamp(createAt),
    raw,
  }
}

function parseCurrentLesson(raw: Record<string, unknown>): CurrentLesson {
  const listRaw = raw["activityList"]
  const list: readonly unknown[] = Array.isArray(listRaw) ? listRaw : []
  return {
    lessonId: raw["lessonId"] != null ? String(raw["lessonId"]) : null,
    activityList: list.map((a) => parseLessonActivity(asRecord(a))),
    raw,
  }
}

function parseSigninActivityDetail(raw: Record<string, unknown>): SigninActivityDetail {
  const endTime = rawStr(raw, "endTime")
  const startTime = rawStr(raw, "startTime")
  const endAt = normalizeLocalDateTime(endTime)
  const startAt = normalizeLocalDateTime(startTime)
  return {
    activityId: rawStr(raw, "activityId"),
    duration: rawInt(raw, "duration"),
    endTime,
    endAt,
    endTimestamp: localDateTimeTimestamp(endAt),
    leftSeconds: rawInt(raw, "leftSeconds"),
    signinType: rawInt(raw, "signinType"),
    startTime,
    startAt,
    startTimestamp: localDateTimeTimestamp(startAt),
    raw,
  }
}

function parseStudentSigninStatus(raw: Record<string, unknown>): StudentSigninStatus {
  return {
    signStatus: rawInt(raw, "signStatus"),
    attendanceStatus: rawInt(raw, "attendanceStatus"),
    signOrder: rawInt(raw, "signOrder"),
    signinType: rawInt(raw, "signinType"),
    raw,
  }
}

function parseStudentSignResult(raw: Record<string, unknown>): StudentSignResult {
  return {
    signStatus: rawInt(raw, "signStatus"),
    attendanceStatus: rawInt(raw, "attendanceStatus"),
    signOrder: rawInt(raw, "signOrder"),
    signinType: rawInt(raw, "signinType"),
    raw,
  }
}

export function createJWMobile(ctx: YSUContext, cas: CasAuthorizer): JWMobileProtocol {
  const { waitForAuthTransition, withAuthTransition } = ctx.transition
  let activeApiBase = ctx.urls.mobile.apiBase
  let mobileJar = ctx.session.createCookieJar()
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let hydrationDone: Promise<void> = Promise.resolve()
  let mobileAuthorized = false
  let inflightMobileAuth: Promise<unknown> | null = null

  function syncEndpoint(): void {
    const currentApiBase = ctx.urls.mobile.apiBase
    if (currentApiBase !== activeApiBase) {
      activeApiBase = currentApiBase
      resetMobileAuth()
    }
  }

  function getJar(): CookieJar {
    return mobileJar
  }

  function setJar(jar: CookieJar): void {
    mobileJar = jar
  }

  function setTimeoutMs(ms: number): void {
    timeoutMs = ms
  }

  async function restoreSession(session: MobileSession): Promise<void> {
    activeApiBase = ctx.urls.mobile.apiBase
    hydrationDone = session.apply(mobileJar)
    await hydrationDone
  }

  function resetMobileAuth(): void {
    mobileJar = ctx.session.createCookieJar()
    hydrationDone = Promise.resolve()
    mobileAuthorized = false
    inflightMobileAuth = null
  }

  async function captureMobileToken(): Promise<string | null> {
    let url = ctx.urls.mobile.auth
    let redirects = 0
    const maxRedirects = 5

    while (redirects < maxRedirects) {
      const resp = await ctx.session.fetchWithJar(mobileJar, {
        method: "GET",
        url,
        redirect: "manual",
        timeoutMs,
      })

      const location = headerSingle(resp.headers, "location") ?? ""
      if (location) {
        const tokenMatch = location.match(/[?&]token=([^&#]+)/)
        if (tokenMatch) {
          return decodeURIComponent(tokenMatch[1]!)
        }

        if (MOBILE_REDIRECT_STATUSES.has(resp.status)) {
          url = new URL(location, url).toString()
          redirects++
          continue
        }
      }

      break
    }

    return null
  }

  async function verifyMobileToken(): Promise<boolean> {
    try {
      const resp = await ctx.session.fetchWithJar(mobileJar, {
        method: "GET",
        url: `${ctx.urls.mobile.apiBase}/`,
        redirect: "follow",
        timeoutMs,
      })
      if (resp.status === 404) return true
      const text = await resp.text()
      try {
        const parsed: unknown = JSON.parse(text)
        if (isPlainRecord(parsed)) {
          const code = parsed["code"]
          if (code === 401 || code === "401") return false
        }
      } catch {
        // Non-JSON treated conservatively as valid.
      }
      return true
    } catch {
      return false
    }
  }

  async function persistSession(): Promise<void> {
    const session = await MobileSession.fromJar(mobileJar, ctx.urls.jwxtCookieDomain)
    if (!session.isEmpty()) {
      ctx.session.setArtifact(YSU_SESSION_ARTIFACT_MOBILE, session.toJSON(), ctx.config.id)
    }
  }

  async function ensureMobileAuthorized(verify = false): Promise<void> {
    syncEndpoint()
    await waitForAuthTransition()
    if (mobileAuthorized) return
    if (inflightMobileAuth) {
      await inflightMobileAuth
      return
    }

    const promise = withAuthTransition(async () => {
      syncEndpoint()
      if (mobileAuthorized) return
      await hydrationDone

      const jwxtCookieDomain = ctx.urls.jwxtCookieDomain
      const mobileUrls = ctx.urls.mobile
      const cookies = await mobileJar.getAllCookies()
      const hasAuthCookie = cookies.some((c) =>
        Boolean(c.name === "Authorization" && c.value && c.domain.includes(jwxtCookieDomain))
      )
      if (hasAuthCookie) {
        if (verify) {
          const valid = await verifyMobileToken()
          if (valid) {
            mobileAuthorized = true
            return
          }
          await mobileJar.removeCookie(jwxtCookieDomain, "/jwmobile", "Authorization")
        } else {
          mobileAuthorized = true
          return
        }
      }

      await cas.authorize(mobileUrls.auth, mobileJar)

      const token = await captureMobileToken()
      if (!token) {
        throw new MobileProtocolError("Failed to obtain mobile JWT token")
      }

      await mobileJar.setCookie(
        `Authorization=${token}; Path=${mobileUrls.cookiePath}; Domain=${jwxtCookieDomain}; Secure`,
        `https://${jwxtCookieDomain}${mobileUrls.cookiePath}/`
      )
    })

    inflightMobileAuth = promise
    try {
      await promise
      mobileAuthorized = true
      persistSession().catch(() => {
        /* ignore persist failures */
      })
    } finally {
      if (inflightMobileAuth === promise) inflightMobileAuth = null
    }
  }

  async function mobileRequest(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await ensureMobileAuthorized()

    const url = `${ctx.urls.mobile.apiBase}/${path}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    const resp = await ctx.session.fetchWithJar(mobileJar, {
      method,
      url,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: "follow",
      timeoutMs,
    })

    if (resp.status === 401 || resp.status === 403) {
      throw new MobileNotLoggedInError(`HTTP ${resp.status} from ${url}`)
    }
    if (resp.status >= 400) {
      throw new MobileProtocolError(`HTTP ${resp.status} from ${url}`)
    }

    const text = await resp.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new MobileProtocolError(
        `non-JSON response from ${url}: ${JSON.stringify(text.slice(0, 200))}`
      )
    }
    if (!isPlainRecord(parsed)) {
      throw new MobileProtocolError(`invalid JSON object from ${url}`)
    }

    const code = parsed["code"]
    if (code !== 200 && code !== "200" && code !== 0 && code !== "0") {
      const msg = typeof parsed["msg"] === "string" ? parsed["msg"] : null
      if (code === 401 || code === "401") {
        throw new MobileNotLoggedInError(msg || `Mobile API authentication failed: ${url}`)
      }
      const codeVal = typeof code === "string" || typeof code === "number" ? code : null
      throw new MobileBusinessError(codeVal, msg, url)
    }

    const data = parsed["data"]
    let returnData: Record<string, unknown>
    if (data === undefined || data === null) {
      returnData = {}
    } else if (!isPlainRecord(data)) {
      returnData = { _value: data }
    } else {
      returnData = data
    }

    persistSession().catch(() => {
      /* ignore persist failures */
    })
    return returnData
  }

  async function mobilePost(
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return mobileRequest("POST", path, body)
  }

  async function withMobileReauth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof MobileNotLoggedInError) {
        await withAuthTransition(async () => {
          resetMobileAuth()
        })
        await waitForAuthTransition()
        return await fn()
      }
      throw e
    }
  }

  async function queryCurrentLesson(params: {
    teachClassId: string
    teachClassType: string
    scheduleId: string
    week: number
    weekDay: number
    startNode: number
    endNode: number
  }): Promise<CurrentLesson> {
    return withMobileReauth(async () => {
      const data = await mobilePost("lesson/queryCurrentLesson", {
        teachClassId: params.teachClassId,
        teachClassType: params.teachClassType,
        scheduleId: params.scheduleId,
        week: params.week,
        weekDay: params.weekDay,
        startNode: params.startNode,
        endNode: params.endNode,
      })
      return parseCurrentLesson(data)
    })
  }

  async function querySigninDetail(params: {
    activityId: string
    title?: string
  }): Promise<SigninActivityDetail> {
    return withMobileReauth(async () => {
      const data = await mobilePost("signin/detail", {
        activityId: params.activityId,
        title: params.title ?? "签到",
      })
      return parseSigninActivityDetail(data)
    })
  }

  async function queryStudentSigninStatus(params: {
    activityId: string
    title?: string
  }): Promise<StudentSigninStatus> {
    return withMobileReauth(async () => {
      const data = await mobilePost("signin/querySigninDetail", {
        activityId: params.activityId,
        title: params.title ?? "签到",
      })
      return parseStudentSigninStatus(data)
    })
  }

  async function studentSign(params: {
    activityId: string
    accuracy?: number
    latitude?: number
    longitude?: number
    code?: string
  }): Promise<StudentSignResult> {
    return withMobileReauth(async () => {
      const body: Record<string, unknown> = {
        activityId: params.activityId,
        accuracy: params.accuracy ?? 0,
        latitude: params.latitude ?? 0,
        longitude: params.longitude ?? 0,
      }
      if (params.code) {
        body.code = params.code
      }
      const data = await mobilePost("signin/sign", body)
      return parseStudentSignResult(data)
    })
  }

  return {
    getJar,
    setJar,
    setTimeoutMs,
    restoreSession,
    resetMobileAuth,
    ensureMobileAuthorized,
    queryCurrentLesson,
    querySigninDetail,
    queryStudentSigninStatus,
    studentSign,
  }
}
