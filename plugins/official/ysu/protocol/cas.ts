/**
 * CAS 认证模块 —— 燕山大学统一身份认证网关。
 *
 * 纯函数 + 模块级状态(cookie jar)。
 */
import { CapacitorCookies } from "@capacitor/core"
import type { CookieEntry, CookieJar, HttpRequest, HttpResponse } from "@orahako/plugin-sdk"
import type { YSUContext } from "../context"
import { collectCookies, cookieEntryFromJSON, headerSingle, installCookies } from "../http-utils"
import type { YSUMfaMethod } from "../types"
import { YSU_SECURE_KEY_CAS_TGC } from "../ysu-config"

// ─── Constants ────────────────────────────────────────────────────────── //

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

// CAS serves different reAuth pages based on User-Agent.
// The mobile version lacks WeChat MFA (only SMS/Cpdaily/WeChat Work).
// Use a desktop UA to get the PC reAuth flow with reAuthType=8 (WeChat).
function desktopUserAgent(appVersion: string): string {
  return `Mozilla/5.0 (X11; Linux x86_64) orahako/${appVersion}`
}

// ─── Types ────────────────────────────────────────────────────────────── //

type MFAMethod = YSUMfaMethod

export interface WechatMFAContext {
  uuid: string
  state: string
  qrImageUrl: string
  /** The full WeChat OAuth authorization URL — open this to trigger the WeChat app. */
  oauthUrl: string
}

export interface MFAChallenge {
  readonly method: MFAMethod
  readonly methodCode: string
  readonly mobileHint: string
  readonly username: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface Step1Result {
  readonly authenticated: boolean
  readonly needsMfa: boolean
  readonly username: string
}

// ─── Exceptions ───────────────────────────────────────────────────────── //

export class CASError extends Error {
  constructor(message?: string) {
    super(message)
    this.name = "CASError"
  }
}

export class NeedCaptchaError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "NeedCaptchaError"
  }
}

export class IPBlockedError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "IPBlockedError"
  }
}

export class LoginFailedError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "LoginFailedError"
  }
}

export class MFARequiredError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "MFARequiredError"
  }
}

export class MFAFailedError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "MFAFailedError"
  }
}

export class NotAuthenticatedError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "NotAuthenticatedError"
  }
}

export class CASProtocolError extends CASError {
  constructor(message?: string) {
    super(message)
    this.name = "CASProtocolError"
  }
}

// ─── CASCredential ────────────────────────────────────────────────────── //

const ALLOWED_PATH_PREFIX = "/authserver"

function isCasPath(p: string): boolean {
  if (!p) return true
  return p === "/" || p.startsWith(ALLOWED_PATH_PREFIX)
}

function isCasCookie(e: CookieEntry, cookieDomain: string): boolean {
  const domain = e.domain.startsWith(".") ? e.domain.slice(1) : e.domain
  return domain === cookieDomain && isCasPath(e.path)
}

export class CASCredential {
  constructor(public readonly cookies: readonly CookieEntry[]) {}

  static async fromJar(jar: CookieJar, cookieDomain: string): Promise<CASCredential> {
    return new CASCredential(await collectCookies(jar, (e) => isCasCookie(e, cookieDomain)))
  }

  async apply(jar: CookieJar): Promise<void> {
    await installCookies(jar, this.cookies)
  }

  toJSON(): string {
    return JSON.stringify({ cookies: this.cookies.map((c) => ({ ...c })) }, null, 2)
  }

  static fromJSON(s: string, cookieDomain: string): CASCredential {
    const data: unknown = JSON.parse(s)
    if (data === null || typeof data !== "object" || !("cookies" in data)) {
      throw new Error("invalid CASCredential JSON: missing 'cookies'")
    }
    const rawCookies = (data as { cookies: unknown }).cookies
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid CASCredential JSON: 'cookies' must be a list")
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (item === null || typeof item !== "object") {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`)
      }
      const e = cookieEntryFromJSON(item as Record<string, unknown>)
      if (!e.domain) {
        return { ...e, domain: cookieDomain }
      }
      return e
    })
    return new CASCredential(entries)
  }
}

// ─── Crypto ───────────────────────────────────────────────────────────── //

const VALID_AES_KEY_BYTES: ReadonlySet<number> = new Set([16, 24, 32])

export function _randomString(length: number, aesChars: string): string {
  const alphabetLen = aesChars.length
  const rejectionThreshold = Math.floor(256 / alphabetLen) * alphabetLen
  const out: string[] = []
  const buf = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buf)
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const b = buf[i]!
      if (b < rejectionThreshold) {
        out.push(aesChars[b % alphabetLen]!)
      }
    }
  }
  return out.join("")
}

export async function encryptPassword(
  password: string,
  salt: string,
  aesChars: string
): Promise<string> {
  const encoder = new TextEncoder()
  const keyBytes = encoder.encode(salt)
  if (!VALID_AES_KEY_BYTES.has(keyBytes.length)) {
    throw new CASProtocolError(
      `unexpected pwdEncryptSalt length: ${keyBytes.length} bytes` +
        ` (expected one of ${[...VALID_AES_KEY_BYTES].sort((a, b) => a - b).join(", ")})`
    )
  }

  const data = encoder.encode(_randomString(64, aesChars) + password)
  const iv = encoder.encode(_randomString(16, aesChars))

  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
  ])
  const cipherBuffer = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, data)
  return bytesToBase64(new Uint8Array(cipherBuffer))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// ─── Parser (DOMParser, no linkedom) ──────────────────────────────────── //

const REAUTH_KEYWORDS: readonly string[] = ["reAuthCheck", "Multifactor", "reAuthType", "二次认证"]

const IP_FROZEN_KEYWORDS: readonly string[] = ["IP freeze", "has been blocked", "IP被冻结"]

const ERROR_SELECTORS: readonly string[] = [
  "#showErrorTip",
  ".form-errorTip",
  ".help-block",
  ".reauth_error_submit",
]

export function extractHiddenFields(
  html: string,
  options: { readonly cllt?: string } = {}
): Record<string, string> {
  const document = new DOMParser().parseFromString(html, "text/html")

  let containers: Element[]
  const allForms = Array.from(document.querySelectorAll("form"))
  if (allForms.length === 0) {
    containers = [document.documentElement]
  } else if (options.cllt !== undefined) {
    containers = allForms.filter((f) => {
      const cllt = f.querySelector('input[name="cllt"]')
      return cllt !== null && cllt.getAttribute("value") === options.cllt
    })
  } else {
    containers = allForms
  }

  const fields: Record<string, string> = {}
  for (const container of containers) {
    for (const inp of container.querySelectorAll("input")) {
      const type = inp.getAttribute("type")?.toLowerCase()
      if (type !== "hidden") continue
      const key = inp.getAttribute("name") ?? inp.getAttribute("id")
      if (!key) continue
      fields[key] = inp.getAttribute("value") ?? ""
    }
  }
  return fields
}

export function isReauthPage(html: string): boolean {
  return REAUTH_KEYWORDS.some((k) => html.includes(k))
}

export function isIpFrozen(html: string): boolean {
  return IP_FROZEN_KEYWORDS.some((k) => html.includes(k))
}

export function extractErrorMessage(html: string): string | null {
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const selector of ERROR_SELECTORS) {
    const el = document.querySelector(selector)
    if (el === null) continue
    const text = el.textContent?.trim()
    if (text) return text
  }
  return null
}

// ─── Provider-scoped state ────────────────────────────────────────────── //

declare global {
  interface Window {
    /** 微信 qrconnect JSONP 轮询写入的全局结果。 */
    wx_errcode?: number
    wx_code?: string
  }
}

export interface CASProtocol {
  getJar(): CookieJar
  setJar(jar: CookieJar): void
  setTimeoutMs(ms: number): void
  resetCAS(): void
  restoreCredential(credential: CASCredential): Promise<void>
  getCredentialApplied(): Promise<void>
  saveCASTGC(): Promise<void>
  logoutCAS(): Promise<void>
  prepareLogin(): Promise<void>
  isAuthenticated(): Promise<boolean>
  credential(): Promise<CASCredential>
  checkCaptchaNeeded(username: string): Promise<boolean>
  loginStep1(
    username: string,
    password: string,
    options?: { readonly captcha?: string }
  ): Promise<Step1Result>
  requestMFACode(username: string, method?: MFAMethod): Promise<MFAChallenge>
  submitMFACode(challenge: MFAChallenge, code: string): Promise<CASCredential>
  initiateWechatMFA(): Promise<WechatMFAContext>
  pollWechatQR(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<{ status: "waiting" | "scanned" | "confirmed" | "expired"; code?: string; errcode?: number }>
  completeWechatMFA(code: string, state: string): Promise<CASCredential>
  authorize(serviceUrl: string, targetJar?: CookieJar): Promise<CookieJar>
}

export function createCAS(ctx: YSUContext): CASProtocol {
  const aesChars = ctx.config.cas.aesChars
  const mfaMethodToCode = ctx.config.cas.mfaMethodToCode
  const mfaMethodToAuthCodeType = ctx.config.cas.mfaMethodToAuthCodeType
  const casUrls = ctx.urls.cas
  const cerBaseUrl = ctx.urls.cas.cerBase
  const casCookieDomain = ctx.urls.casCookieDomain
  const desktopUa = desktopUserAgent(ctx.appVersion)

  let casJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let credentialApplied: Promise<void> = Promise.resolve()

function getJar(): CookieJar {
  return casJar
}

function setJar(jar: CookieJar): void {
  casJar = jar
}

function setTimeoutMs(ms: number): void {
  timeoutMs = ms
}

function resetCAS(): void {
  casJar = ctx.session.createCookieJar()
  credentialApplied = Promise.resolve()
  loginPageCache = null
  loginPageInflight = null
}

async function restoreCredential(credential: CASCredential): Promise<void> {
  credentialApplied = credential.apply(casJar)
  await credentialApplied
}

function getCredentialApplied(): Promise<void> {
  return credentialApplied
}

/**
 * Save CASTGC from jar to secure storage for cross-restart persistence.
 */
async function saveCASTGC(): Promise<void> {
  const allCookies = await casJar.getAllCookies()
  for (const c of allCookies) {
    if (c.name === "CASTGC" && c.value) {
      await ctx.storage.secure.setItem(YSU_SECURE_KEY_CAS_TGC, c.value)
      return
    }
  }
}

/**
 * Logout CAS server session with CASTGC.
 */
async function logoutCAS(): Promise<void> {
  let tgc = await ctx.storage.secure.getItem(YSU_SECURE_KEY_CAS_TGC)
  if (!tgc) {
    const staleTgc = await collectCookies(casJar, (e) => e.name === "CASTGC")
    tgc = staleTgc[0]?.value ?? ""
  }
  if (!tgc) return

  const logoutJar = ctx.session.createCookieJar()
  await logoutJar.setCookie(
    `CASTGC=${tgc}; Domain=${casCookieDomain}; Path=/authserver; Secure`,
    casUrls.authLogout,
    { ignoreError: true }
  )
  await ctx.session.fetchWithJar(logoutJar, {
    method: "GET",
    url: casUrls.authLogout,
    redirect: "follow",
    timeoutMs,
  })
}

// ─── Internal fetch wrapper ───────────────────────────────────────────── //

async function _fetch(req: HttpRequest): Promise<HttpResponse> {
  await credentialApplied
  return ctx.session.fetchWithJar(casJar, req)
}

// ─── Public API ───────────────────────────────────────────────────────── //

/** 访问登录页以建立 CAS session (获取 JSESSIONID cookie)。 */
async function prepareLogin(): Promise<void> {
  await getLoginPage()
  // Sync JSESSIONID from jar → WebView cookie store so that
  // <img src="getCaptcha.htl"> uses the same session as the login POST.
  await syncJarCookiesToWebView()
}

async function syncJarCookiesToWebView(): Promise<void> {
  if (!ctx.native.isNative) return
  const cookies = await casJar.getAllCookies()
  for (const c of cookies) {
    if (!c.value) continue
    const host = c.domain.replace(/^\./, "")
    if (!host.includes(casCookieDomain)) continue
    await CapacitorCookies.setCookie({
      url: `https://${host}${c.path}`,
      key: c.name,
      value: c.value,
      path: c.path,
    })
  }
}

function isUnauthenticatedLocation(url: string): boolean {
  const location = new URL(url, casUrls.authLogin)
  return (
    location.pathname.includes("/authserver/login") ||
    location.pathname.includes("reAuthCheck") ||
    location.searchParams.get("isMultifactor") === "true"
  )
}

async function isAuthenticated(): Promise<boolean> {
  const resp = await _fetch({
    method: "GET",
    url: casUrls.authIndex,
    redirect: "manual",
    timeoutMs,
  })
  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, "location") ?? ""
    if (!location) throw new CASProtocolError("CAS status redirect is missing its destination")
    return !isUnauthenticatedLocation(location)
  }
  if (resp.status === 200) {
    // CapacitorHttp auto-follows redirects — check final URL and re-auth page markers.
    if (isUnauthenticatedLocation(resp.url)) return false
    return !isReauthPage(await resp.text())
  }
  if (resp.status === 401 || resp.status === 403) return false
  throw new CASProtocolError(`CAS status request returned HTTP ${resp.status}`)
}

async function credential(): Promise<CASCredential> {
  return CASCredential.fromJar(casJar, casCookieDomain)
}

/** 检查指定用户是否需要验证码。不获取图片——图片由 `<img>` 直接加载。 */
async function checkCaptchaNeeded(username: string): Promise<boolean> {
  const checkUrl = `${casUrls.checkCaptcha}?username=${encodeURIComponent(username)}`
  try {
    const resp = await _fetch({
      method: "GET",
      url: checkUrl,
      redirect: "manual",
      timeoutMs: Math.min(timeoutMs, 10_000),
    })
    const data = JSON.parse(await resp.text()) as Record<string, unknown>
    return Boolean(data["isNeed"])
  } catch (e) {
    if (e instanceof CASError) throw e
    throw new CASProtocolError("Failed to check captcha requirement")
  }
}

async function loginStep1(
  username: string,
  password: string,
  options: { readonly captcha?: string } = {}
): Promise<Step1Result> {
  const { html, finalUrl } = await getLoginPage()

  // If we landed on the service page (not the login page), already authenticated.
  if (!finalUrl.includes("/authserver/login")) {
    return { authenticated: true, needsMfa: false, username }
  }

  const fields = extractHiddenFields(html, { cllt: "userNameLogin" })
  const execution = fields["execution"]
  const salt = fields["pwdEncryptSalt"]
  if (!execution) {
    throw new CASProtocolError("login page missing 'execution' field")
  }
  if (!salt) {
    throw new CASProtocolError("login page missing 'pwdEncryptSalt' field")
  }

  const encrypted = await encryptPassword(password, salt, aesChars)

  const body = new URLSearchParams({
    username,
    password: encrypted,
    captcha: options.captcha ?? "",
    _eventId: "submit",
    cllt: "userNameLogin",
    dllt: "generalLogin",
    lt: "",
    execution,
    rememberMe: "true",
  })

  const encodedService = encodeURIComponent(casUrls.defaultLoginService)
  const loginUrl = `${casUrls.authLogin}?service=${encodedService}&_=${Date.now()}`
  const resp = await _fetch({
    method: "POST",
    url: loginUrl,
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: cerBaseUrl,
      Referer: `${casUrls.authLogin}?service=${encodedService}`,
    },
    redirect: "manual",
    timeoutMs,
  })
  const result = await classifyStep1Response(resp, username)
  if (result.authenticated) {
    loginPageCache = null
    await saveCASTGC()
  }
  return result
}

async function requestMFACode(
  username: string,
  method: MFAMethod = "cpdaily"
): Promise<MFAChallenge> {
  const typeCode = mfaMethodToCode[method]
  const authCodeType = mfaMethodToAuthCodeType[method]
  if (!typeCode || !authCodeType) {
    throw new CASProtocolError(`unsupported MFA method: ${method}`)
  }

  const encodedService = encodeURIComponent(casUrls.defaultLoginService)
  const referer = `${cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`

  await _fetch({
    method: "POST",
    url: casUrls.reauthType,
    body: new URLSearchParams({
      isMultifactor: "true",
      reAuthType: typeCode,
      service: casUrls.defaultLoginService,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
    timeoutMs: Math.min(timeoutMs, 15_000),
  })

  const resp = await _fetch({
    method: "POST",
    url: casUrls.reauthSendCode,
    body: new URLSearchParams({
      userName: username,
      authCodeTypeName: authCodeType,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
    timeoutMs: Math.min(timeoutMs, 15_000),
  })

  const rawText = await resp.text()
  let result: Record<string, unknown>
  try {
    result = JSON.parse(rawText) as Record<string, unknown>
  } catch {
    throw new CASProtocolError(`reauth send-code returned non-JSON: ${rawText.slice(0, 200)}`)
  }

  const res = typeof result["res"] === "string" ? result["res"] : ""
  const msg = typeof result["returnMessage"] === "string" ? result["returnMessage"] : ""

  if (res === "success" || res === "cpdaily_success" || res === "wechat_success") {
    return {
      method,
      methodCode: typeCode,
      mobileHint: typeof result["mobile"] === "string" ? result["mobile"] : "",
      username,
      raw: result,
    }
  }
  if (res === "code_time_fail") {
    throw new MFAFailedError(`send too frequent: ${msg}`)
  }
  throw new CASProtocolError(
    `unexpected reauth send-code response: res=${JSON.stringify(res)} msg=${JSON.stringify(msg)}`
  )
}

async function submitMFACode(challenge: MFAChallenge, code: string): Promise<CASCredential> {
  const encodedService = encodeURIComponent(casUrls.defaultLoginService)
  const referer = `${cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`
  const resp = await _fetch({
    method: "POST",
    url: casUrls.reauthSubmit,
    body: new URLSearchParams({
      service: casUrls.defaultLoginService,
      reAuthType: challenge.methodCode,
      isMultifactor: "true",
      skipTmpReAuth: "false",
      dynamicCode: code,
      password: "",
      uuid: "",
      answer1: "",
      answer2: "",
      otpCode: "",
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    redirect: "manual",
    timeoutMs,
  })

  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, "location") ?? ""
    try {
      const follow = await _fetch({
        method: "GET",
        url: new URL(location, casUrls.reauthSubmit).toString(),
        redirect: "follow",
        timeoutMs,
      })
      if (!follow.url.includes("/authserver/login")) {
        await saveCASTGC()
        return credential()
      }
    } catch {
      if (location.includes("ticket=") && !location.includes("/authserver/login")) {
        await saveCASTGC()
        return credential()
      }
    }
  }

  if (resp.status === 200) {
    const text = await resp.text()
    try {
      const result = JSON.parse(text) as Record<string, unknown>
      const codeField = result["code"] ?? result["res"]
      if (codeField === "reAuth_failed" || codeField === "reAuth_unauthorized") {
        throw new MFAFailedError(`server rejected MFA code: ${JSON.stringify(result)}`)
      }
    } catch (e) {
      if (e instanceof MFAFailedError) throw e
    }

    const hasFailureMarker =
      text.includes("reauth_error_submit") ||
      text.includes("reAuth_failed") ||
      text.includes("reAuth_unauthorized")
    const hasSuccessMarker = text.includes("reAuth_success") || text.includes("loginSuccess")
    if (hasFailureMarker && !hasSuccessMarker) {
      throw new MFAFailedError("MFA page reported failure")
    }
  }

  if (await isAuthenticated()) {
    await saveCASTGC()
    return credential()
  }

  throw new MFAFailedError("MFA submission did not produce a valid session")
}

// ─── WeChat MFA ────────────────────────────────────────────────────── //

const WECHAT_POLL_BASE = "https://lp.open.weixin.qq.com/connect/l/qrconnect"

async function initiateWechatMFA(): Promise<WechatMFAContext> {
  const referer = `${cerBaseUrl}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true`
  const success = encodeURIComponent(casUrls.defaultLoginService)

  // The mobile reAuth page does not support WeChat MFA (only SMS/Cpdaily).
  // Use a desktop Chrome UA so CAS serves the PC flow with reAuthType=8 (WeChat).
  // The `success` param matches handleGoCombined's logic when service is present.
  const resp = await _fetch({
    method: "GET",
    url: `${casUrls.combinedLogin}?type=weixin&reAuth=2&success=${success}&skipTmpReAuth=false`,
    headers: {
      "User-Agent": desktopUa,
      Referer: referer,
    },
    redirect: "manual",
    timeoutMs,
  })

  // Determine the WeChat OAuth URL.
  // - If we got a redirect, use the Location header.
  // - If CapacitorHttp followed the redirect (status 200 and resp.url points to WeChat), use resp.url.
  // - Otherwise check the body for a meta-refresh or JS redirect.
  let wxOAuthUrl: string

  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, "location")
    if (!location) {
      throw new CASProtocolError("combinedLogin.do returned redirect without Location header")
    }
    wxOAuthUrl = location
  } else if (resp.status === 200) {
    if (resp.url.includes("open.weixin.qq.com")) {
      // CapacitorHttp auto-followed the redirect.
      wxOAuthUrl = resp.url
    } else {
      // Server returned the combinedLogin page directly (200).
      // Try to extract the WeChat OAuth URL from the HTML body.
      const body = await resp.text()
      const metaMatch = body.match(/content="0;\s*url=([^"]+)"/i)
      if (metaMatch) {
        wxOAuthUrl = metaMatch[1]!
      } else {
        throw new CASProtocolError(
          `combinedLogin.do returned status 200 without WeChat redirect. ` +
            `Body snippet: ${body.slice(0, 300)}`
        )
      }
    }
  } else {
    throw new CASProtocolError(`unexpected status ${resp.status} from combinedLogin.do`)
  }

  const wxUrl = new URL(wxOAuthUrl)
  const state = wxUrl.searchParams.get("state")
  if (!state) {
    throw new CASProtocolError("WeChat OAuth URL missing state parameter")
  }

  // Fetch the WeChat QR connect page to extract UUID from the QR image URL.
  // Only need the HTML — short timeout, no resources.
  // NOTE: 必须走 fetchStateless（Web 端经代理）；裸 fetch 在浏览器里会被 CORS 拦截。
  const wxResp = await ctx.http.send({
    method: "GET",
    url: wxOAuthUrl,
    headers: {
      "User-Agent": desktopUa,
      Accept: "text/html",
    },
    redirect: "follow",
    timeoutMs: 8_000,
  })

  const html = await wxResp.text()
  const qrMatch = html.match(/\/connect\/qrcode\/([a-zA-Z0-9]+)/)
  if (!qrMatch) {
    throw new CASProtocolError("could not extract WeChat QR UUID from OAuth page")
  }

  const uuid = qrMatch[1]!
  return {
    uuid,
    state,
    qrImageUrl: `https://open.weixin.qq.com/connect/qrcode/${uuid}`,
    oauthUrl: wxOAuthUrl,
  }
}

interface WechatQrPollRaw {
  /** 空响应体（未知 uuid）时为 null。 */
  errcode: number | null
  code: string
}

/**
 * Web 端轮询走 <script> JSONP —— 微信官方 qrconnect 页面的同款机制。
 * script 标签不受 CORS 限制，响应体执行后写入 window.wx_errcode/wx_code，
 * 浏览器可直接读取，无需经边缘代理转发（代理出口 IP 的轮询会被微信
 * 以 wx_errcode=666 终态拒绝，且 15s 长挂起会占用边缘函数并发）。
 */
function pollWechatQrViaScriptTag(
  uuid: string,
  lastErrcode: number | undefined,
  signal?: AbortSignal
): Promise<WechatQrPollRaw> {
  const { promise, resolve, reject } = Promise.withResolvers<WechatQrPollRaw>()

  let settled = false
  const script = document.createElement("script")

  const cleanup = () => {
    clearTimeout(timer)
    script.remove()
    signal?.removeEventListener("abort", onAbort)
  }
  const fail = (e: Error) => {
    if (settled) return
    settled = true
    cleanup()
    reject(e)
  }
  const onAbort = () => fail(new DOMException("The operation was aborted.", "AbortError"))
  // 服务端无状态变化时挂起约 15s，30s 兜底（与官方页面 timeout:3e4 一致）
  const timer = setTimeout(() => fail(new Error("wechat qr poll timeout")), 30_000)

  // 重置全局位：空响应体（未知 uuid）不会写入这些全局，
  // 不重置会误读上一轮残留值。
  window.wx_errcode = undefined
  window.wx_code = undefined

  script.onload = () => {
    if (settled) return
    settled = true
    cleanup()
    resolve({
      errcode: typeof window.wx_errcode === "number" ? window.wx_errcode : null,
      code: window.wx_code || "",
    })
  }
  script.onerror = () => fail(new Error("wechat qr poll script load failed"))

  if (signal?.aborted) {
    onAbort()
    return promise
  }
  signal?.addEventListener("abort", onAbort)

  const lastParam = lastErrcode !== undefined ? `&last=${lastErrcode}` : ""
  // 追加时间戳防缓存（官方页面 jQuery cache:false 的等效行为）
  script.src = `${WECHAT_POLL_BASE}?uuid=${encodeURIComponent(uuid)}${lastParam}&_=${Date.now()}`
  document.head.appendChild(script)

  return promise
}

/** 原生端轮询：CapacitorHttp 无 CORS 限制，直连微信长轮询端点。 */
async function pollWechatQrViaHttp(
  uuid: string,
  lastErrcode: number | undefined,
  signal?: AbortSignal
): Promise<WechatQrPollRaw> {
  const lastParam = lastErrcode !== undefined ? `&last=${lastErrcode}` : ""
  const pollUrl = `${WECHAT_POLL_BASE}?uuid=${encodeURIComponent(uuid)}${lastParam}`

  const resp = await ctx.http.send({
    method: "GET",
    url: pollUrl,
    headers: {
      Referer: "https://open.weixin.qq.com/",
      "User-Agent": desktopUa,
    },
    redirect: "follow",
    timeoutMs: Math.min(timeoutMs, 30_000),
    signal,
  })

  const text = await resp.text()
  const errcodeMatch = text.match(/window\.wx_errcode=(\d+)/)
  const codeMatch = text.match(/window\.wx_code='([^']*)'/)

  return {
    errcode: errcodeMatch ? parseInt(errcodeMatch[1]!, 10) : null,
    code: codeMatch?.[1] || "",
  }
}

async function pollWechatQR(
  uuid: string,
  lastErrcode?: number,
  signal?: AbortSignal
): Promise<{
  status: "waiting" | "scanned" | "confirmed" | "expired"
  code?: string
  errcode?: number
}> {
  const { errcode, code } = ctx.native.isNative
    ? await pollWechatQrViaHttp(uuid, lastErrcode, signal)
    : await pollWechatQrViaScriptTag(uuid, lastErrcode, signal)

  // errcode 语义与官方 qrconnect 页面 JS 的 switch 一致：
  //   405 已确认（带 code）；404 已扫码；408 等待扫码；
  //   403 用户在微信中取消（官方行为：带 last=403 继续轮询）；
  //   402 二维码过期；空响应体（未知 uuid）与其余未知码（666 等）均为终态，
  //   官方页面对 default 分支不再轮询 —— 统一映射为 expired 由 UI 提示重新获取。
  if (errcode === 405 && code) {
    return { status: "confirmed", code, errcode }
  }
  if (errcode === 404) {
    return { status: "scanned", errcode }
  }
  if (errcode === 408 || errcode === 403) {
    return { status: "waiting", errcode }
  }
  return { status: "expired", errcode: errcode ?? undefined }
}

async function completeWechatMFA(code: string, state: string): Promise<CASCredential> {
  const callbackUrl = `${casUrls.callback}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`

  let resp = await _fetch({
    method: "GET",
    url: callbackUrl,
    headers: { Referer: "https://open.weixin.qq.com/" },
    redirect: "manual",
    timeoutMs,
  })

  // Follow the CAS redirect chain after callback.
  // The callback returns 200 HTML which auto-navigates to /authserver/login;
  // we short-circuit that and go directly to /authserver/login.
  if (resp.status === 200) {
    resp = await _fetch({
      method: "GET",
      url: casUrls.authLogin,
      headers: { Referer: callbackUrl },
      redirect: "manual",
      timeoutMs,
    })
  }

  // Follow redirects through the ticket-granting chain.
  for (let i = 0; i < 10; i++) {
    if (!REDIRECT_STATUSES.has(resp.status)) break

    const location = headerSingle(resp.headers, "location")
    if (!location) break

    const nextUrl = new URL(location, resp.url).toString()

    // If we reach the service page with a ticket, we're done.
    if (nextUrl.includes("ticket=") && !nextUrl.includes("/authserver/login")) {
      resp = await _fetch({
        method: "GET",
        url: nextUrl,
        redirect: "follow",
        timeoutMs,
      })
      break
    }

    resp = await _fetch({
      method: "GET",
      url: nextUrl,
      redirect: "manual",
      timeoutMs,
    })
  }

  if (await isAuthenticated()) {
    await saveCASTGC()
    return credential()
  }

  throw new CASProtocolError("WeChat MFA completed but session not established")
}

async function authorize(
  serviceUrl: string,
  targetJar?: CookieJar
): Promise<CookieJar> {
  const source = casJar
  const target = targetJar ?? ctx.session.createCookieJar()
  await credentialApplied
  await (await CASCredential.fromJar(source, casCookieDomain)).apply(target)

  const encoded = encodeURIComponent(serviceUrl)
  const url = `${casUrls.authLogin}?service=${encoded}`

  let resp: HttpResponse
  try {
    resp = await ctx.session.fetchWithJar(target, {
      method: "GET",
      url,
      redirect: "follow",
      timeoutMs,
    })
  } catch (e) {
    throw new CASProtocolError(`authorize redirect chain failed: ${(e as Error).message}`)
  }

  if (source !== casJar) {
    throw new NotAuthenticatedError("CAS session changed during authorization")
  }
  if (resp.status >= 400 && resp.status !== 401 && resp.status !== 403) {
    throw new CASProtocolError(`CAS authorization returned HTTP ${resp.status}`)
  }
  if (!resp.url || resp.status < 200 || resp.status >= 300) {
    throw new NotAuthenticatedError("CAS authorization did not complete")
  }
  const finalUrl = new URL(resp.url)
  const onCAS = finalUrl.origin === new URL(casUrls.authLogin).origin
  if (
    isUnauthenticatedLocation(resp.url) ||
    (onCAS && new URL(serviceUrl).origin !== finalUrl.origin) ||
    (onCAS && isReauthPage(await resp.text()))
  ) {
    throw new NotAuthenticatedError("CAS requires login or secondary authentication")
  }

  const updated = await CASCredential.fromJar(target, casCookieDomain)
  if (source !== casJar) {
    throw new NotAuthenticatedError("CAS session changed during authorization")
  }
  await updated.apply(source)
  if (source !== casJar) {
    throw new NotAuthenticatedError("CAS session changed during authorization")
  }
  await saveCASTGC()

  return target
}

// ─── Internal helpers ─────────────────────────────────────────────────── //

let loginPageCache: { html: string; finalUrl: string; ts: number } | null = null
let loginPageInflight: Promise<{ html: string; finalUrl: string }> | null = null
const LOGIN_PAGE_CACHE_TTL = 300_000

async function getLoginPage(): Promise<{ html: string; finalUrl: string }> {
  if (loginPageCache && Date.now() - loginPageCache.ts < LOGIN_PAGE_CACHE_TTL) {
    return { html: loginPageCache.html, finalUrl: loginPageCache.finalUrl }
  }
  if (loginPageInflight) {
    return loginPageInflight
  }

  loginPageInflight = (async () => {
    try {
      loginPageCache = null
      const url = `${casUrls.authLogin}?service=${encodeURIComponent(casUrls.defaultLoginService)}`

      // Follow redirects so we land on the actual destination.
      // If TGC is valid, CAS 302s to the service page (already authenticated).
      // If TGC is stale, CAS 302s to login with a fresh session cookie.
      let resp = await _fetch({
        method: "GET",
        url,
        redirect: "follow",
        timeoutMs,
      })

      if (resp.url.includes("/authserver/login")) {
        // TGC was stale — CAS bounced us back to login.
        // Only retry when a TGC actually existed; a normal unauthenticated request
        // already returned a clean login page and should not pay for a second chain.
        const staleTgc = await collectCookies(casJar, (e) => e.name === "CASTGC")
        if (staleTgc.length > 0) {
          for (const c of staleTgc) {
            await casJar.removeCookie(c.domain, c.path, c.name)
          }
          resp = await _fetch({
            method: "GET",
            url,
            redirect: "follow",
            timeoutMs,
          })
        }
        if (resp.url.includes("/authserver/login")) {
          const body = await resp.text()
          if (resp.status !== 200) {
            throw new CASProtocolError(`login page returned status ${resp.status}`)
          }
          const result = { html: body, finalUrl: resp.url }
          loginPageCache = { ...result, ts: Date.now() }
          return result
        }
      }

      // Either already authenticated (landed on service page) or
      // a non-login destination. Return as-is.
      const result = { html: await resp.text(), finalUrl: resp.url }
      loginPageCache = { ...result, ts: Date.now() }
      return result
    } finally {
      loginPageInflight = null
    }
  })()

  return loginPageInflight
}

async function classifyStep1Response(resp: HttpResponse, username: string): Promise<Step1Result> {
  if (REDIRECT_STATUSES.has(resp.status)) {
    const location = headerSingle(resp.headers, "location") ?? ""
    const absoluteLocation = new URL(location, casUrls.authLogin).toString()

    if (location.includes("reAuthCheck") || location.includes("isMultifactor")) {
      await _fetch({
        method: "GET",
        url: absoluteLocation,
        headers: {
          "User-Agent": desktopUa,
        },
        redirect: "manual",
        timeoutMs,
      })
      return { authenticated: false, needsMfa: true, username }
    }

    if (location.includes(casUrls.defaultLoginService) || location.includes("ticket=")) {
      await _fetch({
        method: "GET",
        url: absoluteLocation,
        redirect: "manual",
        timeoutMs,
      })
      return { authenticated: true, needsMfa: false, username }
    }

    let follow: HttpResponse
    try {
      follow = await _fetch({
        method: "GET",
        url: absoluteLocation,
        redirect: "follow",
        timeoutMs,
      })
    } catch (e) {
      throw new CASProtocolError(`failed to follow redirect: ${(e as Error).message}`)
    }

    if (follow.url.includes(casUrls.defaultLoginService) || follow.url.includes("ticket=")) {
      return { authenticated: true, needsMfa: false, username }
    }

    const followText = await follow.text()

    if (isReauthPage(followText)) {
      return { authenticated: false, needsMfa: true, username }
    }

    // Redirect back to login page — authentication failed.
    if (follow.url.includes("/authserver/login")) {
      if (isIpFrozen(followText)) {
        throw new IPBlockedError("IP 被认证网关冻结,请稍后再试或联系管理员")
      }
      const error = extractErrorMessage(followText)
      if (error) {
        if (error.includes("验证码") || error.toLowerCase().includes("captcha")) {
          throw new NeedCaptchaError(error)
        }
        throw new LoginFailedError(error)
      }
      throw new LoginFailedError("登录失败(服务器未返回具体错误信息)")
    }

    throw new CASProtocolError(`unrecognized redirect chain after first-factor: ${follow.url}`)
  }

  if (resp.status === 200) {
    const text = await resp.text()
    if (isIpFrozen(text)) {
      throw new IPBlockedError("IP 被认证网关冻结,请稍后再试或联系管理员")
    }
    if (isReauthPage(text)) {
      return { authenticated: false, needsMfa: true, username }
    }
    const error = extractErrorMessage(text)
    if (error) {
      if (error.includes("验证码") || error.toLowerCase().includes("captcha")) {
        throw new NeedCaptchaError(error)
      }
      throw new LoginFailedError(error)
    }
    throw new LoginFailedError("first-factor authentication failed (no error message extracted)")
  }

  // Unexpected status codes (e.g. 401, 403, 500) — read body for diagnostics.
  const body = await resp.text()
  if (isIpFrozen(body)) {
    throw new IPBlockedError("IP 被认证网关冻结,请稍后再试或联系管理员")
  }
  const error = extractErrorMessage(body)
  if (error) {
    if (error.includes("验证码") || error.toLowerCase().includes("captcha")) {
      throw new NeedCaptchaError(error)
    }
    throw new LoginFailedError(error)
  }
  throw new CASProtocolError(
    `unexpected status code from CAS: ${resp.status}` +
      (body ? ` — body snippet: ${body.slice(0, 300)}` : "")
  )
}

  return {
    getJar,
    setJar,
    setTimeoutMs,
    resetCAS,
    restoreCredential,
    getCredentialApplied,
    saveCASTGC,
    logoutCAS,
    prepareLogin,
    isAuthenticated,
    credential,
    checkCaptchaNeeded,
    loginStep1,
    requestMFACode,
    submitMFACode,
    initiateWechatMFA,
    pollWechatQR,
    completeWechatMFA,
    authorize,
  }
}
