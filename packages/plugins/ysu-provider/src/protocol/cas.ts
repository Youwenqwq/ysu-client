/**
 * CAS 认证模块 —— 燕山大学统一身份认证网关。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import { bytesToBase64, type CookieEntry, type HttpRequest, type HttpResponse } from "@orahako/sdk"
import type { YSUContext } from "../context"
import {
  collectCookies,
  cookieEntryFromJSON,
  errorMessage,
  headerSingle,
  installCookies,
  isPlainRecord,
} from "../http-utils"
import type { YSUMfaMethod } from "../types"
import { YSU_SECURE_KEY_CAS_TGC } from "../ysu-config"

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

function desktopUserAgent(appVersion: string): string {
  return `Mozilla/5.0 (X11; Linux x86_64) orahako/${appVersion}`
}

type MFAMethod = YSUMfaMethod

export interface WechatMFAContext {
  uuid: string
  state: string
  qrImageUrl: string
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
    if (!isPlainRecord(data) || !("cookies" in data)) {
      throw new Error("invalid CASCredential JSON: missing 'cookies'")
    }
    const rawCookies = data.cookies
    if (!Array.isArray(rawCookies)) {
      throw new Error("invalid CASCredential JSON: 'cookies' must be a list")
    }
    const entries: CookieEntry[] = rawCookies.map((item) => {
      if (!isPlainRecord(item)) {
        throw new TypeError(`invalid cookie entry: ${JSON.stringify(item)}`)
      }
      const e = cookieEntryFromJSON(item)
      if (!e.domain) {
        return { ...e, domain: cookieDomain }
      }
      return e
    })
    return new CASCredential(entries)
  }
}

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

const REAUTH_KEYWORDS: readonly string[] = ["reAuthCheck", "Multifactor", "reAuthType", "二次认证"]
const IP_FROZEN_KEYWORDS: readonly string[] = ["IP freeze", "has been blocked", "IP被冻结"]
const ERROR_SELECTORS: readonly string[] = [
  "#showErrorTip",
  ".form-errorTip",
  ".help-block",
  ".reauth_error_submit",
]

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag)) !== null) {
    const key = m[1]!.toLowerCase()
    const val = m[2] ?? m[3] ?? m[4] ?? ""
    attrs[key] = val
  }
  return attrs
}

function extractHiddenFieldsFallback(
  html: string,
  options: { readonly cllt?: string } = {}
): Record<string, string> {
  const formRe = /<form\b[^>]*>[\s\S]*?<\/form>/gi
  const allForms = Array.from(html.matchAll(formRe), (m) => m[0])
  let scopes: string[]
  if (allForms.length === 0) {
    scopes = [html]
  } else if (options.cllt !== undefined) {
    scopes = allForms.filter((formHtml) => {
      for (const inpMatch of formHtml.matchAll(/<input\b[^>]*>/gi)) {
        const attrs = parseAttributes(inpMatch[0])
        if (attrs["name"] === "cllt" && attrs["value"] === options.cllt) {
          return true
        }
      }
      return false
    })
  } else {
    scopes = allForms
  }

  const fields: Record<string, string> = {}
  for (const scope of scopes) {
    for (const inpMatch of scope.matchAll(/<input\b[^>]*>/gi)) {
      const attrs = parseAttributes(inpMatch[0])
      if (attrs["type"]?.toLowerCase() !== "hidden") continue
      const key = attrs["name"] || attrs["id"]
      if (!key) continue
      fields[key] = attrs["value"] ?? ""
    }
  }
  return fields
}

export function extractHiddenFields(
  html: string,
  options: { readonly cllt?: string } = {}
): Record<string, string> {
  if (typeof DOMParser === "undefined") {
    return extractHiddenFieldsFallback(html, options)
  }
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

function extractErrorMessageFallback(html: string): string | null {
  const patterns = [
    /<([a-z0-9]+)\b[^>]*\bid=["']showErrorTip["'][^>]*>([\s\S]*?)<\/\1>/i,
    /<([a-z0-9]+)\b[^>]*\bclass=["'][^"']*\bform-errorTip\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
    /<([a-z0-9]+)\b[^>]*\bclass=["'][^"']*\bhelp-block\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
    /<([a-z0-9]+)\b[^>]*\bclass=["'][^"']*\breauth_error_submit\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (!match) continue
    const text = match[2]!.replace(/<[^>]*>/g, "").trim()
    if (text) return text
  }
  return null
}

export function extractErrorMessage(html: string): string | null {
  if (typeof DOMParser === "undefined") {
    return extractErrorMessageFallback(html)
  }
  const document = new DOMParser().parseFromString(html, "text/html")
  for (const selector of ERROR_SELECTORS) {
    const el = document.querySelector(selector)
    if (el === null) continue
    const text = el.textContent?.trim()
    if (text) return text
  }
  return null
}

declare global {
  interface Window {
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
  ): Promise<{
    status: "waiting" | "scanned" | "confirmed" | "expired"
    code?: string
    errcode?: number
  }>
  completeWechatMFA(code: string, state: string): Promise<CASCredential>
  authorize(serviceUrl: string, targetJar?: CookieJar): Promise<CookieJar>
}

export type CasAuthorizer = Pick<CASProtocol, "authorize" | "getCredentialApplied">

interface WechatQrPollRaw {
  errcode: number | null
  code: string
}

const WECHAT_POLL_BASE = "https://lp.open.weixin.qq.com/connect/l/qrconnect"

function resolveWebViewCookieBridge():
  | ((options: { url: string; key: string; value: string; path: string }) => Promise<unknown>)
  | undefined {
  const cap: unknown = Reflect.get(globalThis, "Capacitor")
  if (!isPlainRecord(cap)) return undefined
  const plugins = cap.Plugins
  if (!isPlainRecord(plugins)) return undefined
  const cookiesPlugin = plugins.CapacitorCookies
  if (
    (typeof cookiesPlugin === "object" || typeof cookiesPlugin === "function") &&
    cookiesPlugin !== null
  ) {
    const fn: unknown = Reflect.get(cookiesPlugin, "setCookie")
    if (typeof fn === "function") {
      return (opts) => Promise.resolve(fn.call(cookiesPlugin, opts))
    }
  }
  return undefined
}

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
  const timer = setTimeout(() => fail(new Error("wechat qr poll timeout")), 30_000)

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
  script.src = `${WECHAT_POLL_BASE}?uuid=${encodeURIComponent(uuid)}${lastParam}&_=${Date.now()}`
  document.head.appendChild(script)

  return promise
}

export function createCAS(ctx: YSUContext): CASProtocol {
  const aesChars = ctx.config.cas.aesChars
  const mfaMethodToCode = ctx.config.cas.mfaMethodToCode
  const mfaMethodToAuthCodeType = ctx.config.cas.mfaMethodToAuthCodeType
  const desktopUa = desktopUserAgent(ctx.appVersion)

  let casJar = ctx.session.createCookieJar()
  let timeoutMs = 30_000
  let credentialApplied: Promise<void> = Promise.resolve()
  let loginPageCache: { cerBase: string; html: string; finalUrl: string; ts: number } | null = null
  let loginPageInflight: Promise<{ html: string; finalUrl: string }> | null = null
  const LOGIN_PAGE_CACHE_TTL = 300_000

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

  async function restoreCredential(cred: CASCredential): Promise<void> {
    credentialApplied = cred.apply(casJar)
    await credentialApplied
  }

  function getCredentialApplied(): Promise<void> {
    return credentialApplied
  }

  async function saveCASTGC(): Promise<void> {
    const allCookies = await casJar.getAllCookies()
    for (const c of allCookies) {
      if (c.name === "CASTGC" && c.value) {
        await ctx.storage.secure.setItem(YSU_SECURE_KEY_CAS_TGC, c.value)
        return
      }
    }
  }

  async function logoutCAS(): Promise<void> {
    const casUrls = ctx.urls.cas
    const casCookieDomain = ctx.urls.casCookieDomain
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

  async function _fetch(req: HttpRequest): Promise<HttpResponse> {
    await credentialApplied
    return ctx.session.fetchWithJar(casJar, req)
  }

  async function syncJarCookiesToWebView(): Promise<void> {
    if (!ctx.native.isNative) return
    const setWebViewCookie = resolveWebViewCookieBridge()
    if (!setWebViewCookie) return
    const casCookieDomain = ctx.urls.casCookieDomain
    const cookies = await casJar.getAllCookies()
    for (const c of cookies) {
      if (!c.value) continue
      const host = c.domain.replace(/^\./, "")
      if (!host.includes(casCookieDomain)) continue
      await setWebViewCookie({
        url: `https://${host}${c.path}`,
        key: c.name,
        value: c.value,
        path: c.path,
      })
    }
  }

  function isReauthLocation(url: string, baseAuthUrl: string): boolean {
    const location = new URL(url, baseAuthUrl)
    return (
      location.pathname.includes("reAuthCheck") ||
      location.searchParams.get("isMultifactor") === "true"
    )
  }

  function isUnauthenticatedLocation(url: string, baseAuthUrl: string): boolean {
    const location = new URL(url, baseAuthUrl)
    return location.pathname.includes("/authserver/login") || isReauthLocation(url, baseAuthUrl)
  }

  async function inspectAuthStatus(): Promise<{
    readonly authenticated: boolean
    readonly needsMfa: boolean
  }> {
    const casUrls = ctx.urls.cas
    const resp = await _fetch({
      method: "GET",
      url: casUrls.authIndex,
      redirect: "manual",
      timeoutMs,
    })
    if (REDIRECT_STATUSES.has(resp.status)) {
      const location = headerSingle(resp.headers, "location") ?? ""
      if (!location) throw new CASProtocolError("CAS status redirect is missing its destination")
      if (isReauthLocation(location, casUrls.authLogin)) {
        return { authenticated: false, needsMfa: true }
      }
      if (isUnauthenticatedLocation(location, casUrls.authLogin)) {
        return { authenticated: false, needsMfa: false }
      }
      return { authenticated: true, needsMfa: false }
    }
    if (resp.status === 200) {
      if (isReauthLocation(resp.url, casUrls.authLogin)) {
        return { authenticated: false, needsMfa: true }
      }
      if (isUnauthenticatedLocation(resp.url, casUrls.authLogin)) {
        return { authenticated: false, needsMfa: false }
      }
      const text = await resp.text()
      if (isReauthPage(text)) {
        return { authenticated: false, needsMfa: true }
      }
      return { authenticated: true, needsMfa: false }
    }
    if (resp.status === 401 || resp.status === 403) {
      return { authenticated: false, needsMfa: false }
    }
    throw new CASProtocolError(`CAS status request returned HTTP ${resp.status}`)
  }

  async function isAuthenticated(): Promise<boolean> {
    const status = await inspectAuthStatus()
    return status.authenticated
  }

  async function credential(): Promise<CASCredential> {
    return CASCredential.fromJar(casJar, ctx.urls.casCookieDomain)
  }

  async function checkCaptchaNeeded(username: string): Promise<boolean> {
    const checkUrl = `${ctx.urls.cas.checkCaptcha}?username=${encodeURIComponent(username)}`
    try {
      const resp = await _fetch({
        method: "GET",
        url: checkUrl,
        redirect: "manual",
        timeoutMs: Math.min(timeoutMs, 10_000),
      })
      const parsed: unknown = JSON.parse(await resp.text())
      return isPlainRecord(parsed) && Boolean(parsed["isNeed"])
    } catch (e) {
      if (e instanceof CASError) throw e
      throw new CASProtocolError("Failed to check captcha requirement")
    }
  }

  async function getLoginPage(): Promise<{ html: string; finalUrl: string }> {
    const casUrls = ctx.urls.cas
    if (
      loginPageCache &&
      loginPageCache.cerBase === casUrls.cerBase &&
      Date.now() - loginPageCache.ts < LOGIN_PAGE_CACHE_TTL
    ) {
      return { html: loginPageCache.html, finalUrl: loginPageCache.finalUrl }
    }
    if (loginPageInflight) {
      return loginPageInflight
    }

    loginPageInflight = (async () => {
      try {
        loginPageCache = null
        const url = `${casUrls.authLogin}?service=${encodeURIComponent(casUrls.defaultLoginService)}`

        let resp = await _fetch({
          method: "GET",
          url,
          redirect: "follow",
          timeoutMs,
        })

        if (resp.url.includes("/authserver/login")) {
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
            loginPageCache = { ...result, cerBase: casUrls.cerBase, ts: Date.now() }
            return result
          }
        }

        const result = { html: await resp.text(), finalUrl: resp.url }
        loginPageCache = { ...result, cerBase: casUrls.cerBase, ts: Date.now() }
        return result
      } finally {
        loginPageInflight = null
      }
    })()

    return loginPageInflight
  }

  async function prepareLogin(): Promise<void> {
    await getLoginPage()
    await syncJarCookiesToWebView()
  }

  async function classifyStep1Response(resp: HttpResponse, username: string): Promise<Step1Result> {
    const casUrls = ctx.urls.cas
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
        throw new CASProtocolError(`failed to follow redirect: ${errorMessage(e)}`)
      }

      if (follow.url.includes(casUrls.defaultLoginService) || follow.url.includes("ticket=")) {
        return { authenticated: true, needsMfa: false, username }
      }

      const followText = await follow.text()

      if (isReauthPage(followText) || isReauthLocation(follow.url, casUrls.authLogin)) {
        return { authenticated: false, needsMfa: true, username }
      }

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
      if (isReauthPage(text) || isReauthLocation(resp.url, casUrls.authLogin)) {
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

  async function loginStep1(
    username: string,
    password: string,
    options: { readonly captcha?: string } = {}
  ): Promise<Step1Result> {
    const casUrls = ctx.urls.cas
    const { html, finalUrl } = await getLoginPage()

    if (!finalUrl.includes("/authserver/login")) {
      if (isReauthLocation(finalUrl, casUrls.authLogin) || isReauthPage(html)) {
        return { authenticated: false, needsMfa: true, username }
      }
      const verified = await inspectAuthStatus()
      if (verified.authenticated) {
        loginPageCache = null
        await saveCASTGC()
        return { authenticated: true, needsMfa: false, username }
      }
      if (verified.needsMfa) {
        return { authenticated: false, needsMfa: true, username }
      }
      throw new LoginFailedError("CAS session is not authenticated")
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
        Origin: casUrls.cerBase,
        Referer: `${casUrls.authLogin}?service=${encodedService}`,
      },
      redirect: "manual",
      timeoutMs,
    })
    const result = await classifyStep1Response(resp, username)
    if (result.authenticated) {
      const verified = await inspectAuthStatus()
      if (!verified.authenticated) {
        if (verified.needsMfa) {
          return { authenticated: false, needsMfa: true, username }
        }
        throw new LoginFailedError("CAS session verification failed after login")
      }
      loginPageCache = null
      await saveCASTGC()
    }
    return result
  }

  async function requestMFACode(
    username: string,
    method: MFAMethod = "cpdaily"
  ): Promise<MFAChallenge> {
    const casUrls = ctx.urls.cas
    const typeCode = mfaMethodToCode[method]
    const authCodeType = mfaMethodToAuthCodeType[method]
    if (!typeCode || !authCodeType) {
      throw new CASProtocolError(`unsupported MFA method: ${method}`)
    }

    const encodedService = encodeURIComponent(casUrls.defaultLoginService)
    const referer = `${casUrls.cerBase}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`

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
    let parsed: unknown
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new CASProtocolError(`reauth send-code returned non-JSON: ${rawText.slice(0, 200)}`)
    }
    if (!isPlainRecord(parsed)) {
      throw new CASProtocolError("reauth send-code returned invalid JSON object")
    }

    const res = typeof parsed["res"] === "string" ? parsed["res"] : ""
    const msg = typeof parsed["returnMessage"] === "string" ? parsed["returnMessage"] : ""

    if (res === "success" || res === "cpdaily_success" || res === "wechat_success") {
      return {
        method,
        methodCode: typeCode,
        mobileHint: typeof parsed["mobile"] === "string" ? parsed["mobile"] : "",
        username,
        raw: parsed,
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
    const casUrls = ctx.urls.cas
    const encodedService = encodeURIComponent(casUrls.defaultLoginService)
    const referer = `${casUrls.cerBase}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodedService}`
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
        await _fetch({
          method: "GET",
          url: new URL(location, casUrls.reauthSubmit).toString(),
          redirect: "follow",
          timeoutMs,
        })
      } catch {
        // Ignore service follow error; verify authenticated CAS state below.
      }
    }

    if (resp.status === 200) {
      const text = await resp.text()
      try {
        const parsed: unknown = JSON.parse(text)
        if (isPlainRecord(parsed)) {
          const codeField = parsed["code"] ?? parsed["res"]
          if (codeField === "reAuth_failed" || codeField === "reAuth_unauthorized") {
            throw new MFAFailedError(`server rejected MFA code: ${JSON.stringify(parsed)}`)
          }
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
      loginPageCache = null
      await saveCASTGC()
      return credential()
    }

    throw new MFAFailedError("MFA submission did not produce a valid session")
  }

  async function initiateWechatMFA(): Promise<WechatMFAContext> {
    const casUrls = ctx.urls.cas
    const referer = `${casUrls.cerBase}/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true`
    const success = encodeURIComponent(casUrls.defaultLoginService)

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

    let wxOAuthUrl: string

    if (REDIRECT_STATUSES.has(resp.status)) {
      const location = headerSingle(resp.headers, "location")
      if (!location) {
        throw new CASProtocolError("combinedLogin.do returned redirect without Location header")
      }
      wxOAuthUrl = location
    } else if (resp.status === 200) {
      if (resp.url.includes("open.weixin.qq.com")) {
        wxOAuthUrl = resp.url
      } else {
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
    const casUrls = ctx.urls.cas
    const callbackUrl = `${casUrls.callback}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`

    let resp = await _fetch({
      method: "GET",
      url: callbackUrl,
      headers: { Referer: "https://open.weixin.qq.com/" },
      redirect: "manual",
      timeoutMs,
    })

    if (resp.status === 200) {
      resp = await _fetch({
        method: "GET",
        url: casUrls.authLogin,
        headers: { Referer: callbackUrl },
        redirect: "manual",
        timeoutMs,
      })
    }

    for (let i = 0; i < 10; i++) {
      if (!REDIRECT_STATUSES.has(resp.status)) break

      const location = headerSingle(resp.headers, "location")
      if (!location) break

      const nextUrl = new URL(location, resp.url).toString()

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
      loginPageCache = null
      await saveCASTGC()
      return credential()
    }

    throw new CASProtocolError("WeChat MFA completed but session not established")
  }

  async function authorize(serviceUrl: string, targetJar?: CookieJar): Promise<CookieJar> {
    const casUrls = ctx.urls.cas
    const casCookieDomain = ctx.urls.casCookieDomain
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
      throw new CASProtocolError(`authorize redirect chain failed: ${errorMessage(e)}`)
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
      isUnauthenticatedLocation(resp.url, casUrls.authLogin) ||
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
