import type { CookieJar } from "@orahako/academic-sdk"
import type { CookieEntry, HttpRequest, HttpResponse, PluginHttpService } from "@orahako/sdk"

export const MAX_COOKIE_REDIRECTS = 10

interface MutableCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  expires: number | null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

function defaultPathFromUrl(pathname: string): string {
  const lastSlash = pathname.lastIndexOf("/")
  if (lastSlash <= 0) return "/"
  return pathname.slice(0, lastSlash)
}

export function domainMatches(cookieDomain: string, host: string): boolean {
  if (!cookieDomain) return true
  const normalizedDomain = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain
  const normalizedHost = host.toLowerCase()
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/"
}

export function secureMatches(cookie: Pick<CookieEntry, "secure">, url: string): boolean {
  if (!cookie.secure) return true
  return url.startsWith("https:") || url.startsWith("wss:")
}

function parseSetCookie(rawCookie: string, url: string): MutableCookie | null {
  const trimmed = rawCookie.trim()
  if (!trimmed) return null

  const firstSemi = trimmed.indexOf(";")
  const nameValue = firstSemi === -1 ? trimmed : trimmed.slice(0, firstSemi)
  const rest = firstSemi === -1 ? "" : trimmed.slice(firstSemi + 1)

  const eqIdx = nameValue.indexOf("=")
  const name = eqIdx === -1 ? nameValue.trim() : nameValue.slice(0, eqIdx).trim()
  const value = eqIdx === -1 ? "" : nameValue.slice(eqIdx + 1).trim()
  if (!name) return null

  const parsedUrl = safeParseUrl(url)
  const defaultDomain = parsedUrl?.hostname.toLowerCase() ?? ""
  const defaultPath = defaultPathFromUrl(parsedUrl?.pathname ?? "/")

  let domain = defaultDomain
  let path = defaultPath
  let secure = false
  let expires: number | null = null

  for (const attr of rest.split(";")) {
    const eqPos = attr.indexOf("=")
    const rawKey = eqPos === -1 ? attr : attr.slice(0, eqPos)
    const rawVal = eqPos === -1 ? undefined : attr.slice(eqPos + 1)
    const key = rawKey.trim().toLowerCase()
    const val = rawVal === undefined ? "" : rawVal.trim()

    switch (key) {
      case "domain":
        if (val) {
          domain = val.toLowerCase()
          if (!domain.startsWith(".")) {
            domain = `.${domain}`
          }
        }
        break
      case "path":
        if (val && val.startsWith("/")) {
          path = val
        }
        break
      case "expires": {
        const parsedDate = new Date(val)
        if (!Number.isNaN(parsedDate.getTime())) {
          expires = Math.floor(parsedDate.getTime() / 1000)
        }
        break
      }
      case "max-age": {
        const seconds = Number(val)
        if (Number.isFinite(seconds)) {
          expires = Math.floor(Date.now() / 1000) + Math.trunc(seconds)
        }
        break
      }
      case "secure":
        secure = true
        break
      default:
        break
    }
  }

  return { name, value, domain, path, secure, expires }
}

function parseStoredCookie(item: unknown): MutableCookie | null {
  if (!isPlainRecord(item)) return null
  const name = typeof item.name === "string" ? item.name : ""
  if (!name) return null
  const value = typeof item.value === "string" ? item.value : ""
  const domain = typeof item.domain === "string" ? item.domain : ""
  const path = typeof item.path === "string" ? item.path : "/"
  const secure = Boolean(item.secure)
  let expires: number | null = null
  const expRaw = item.expires
  if (typeof expRaw === "number" && Number.isFinite(expRaw)) {
    expires = Math.trunc(expRaw)
  } else if (typeof expRaw === "string" && expRaw !== "") {
    const numeric = Number(expRaw)
    if (Number.isFinite(numeric)) {
      expires = Math.trunc(numeric)
    }
  }
  return { name, value, domain, path, secure, expires }
}

export class SimpleCookieJar implements CookieJar {
  private cookies: MutableCookie[] = []

  async setCookie(
    cookieStr: string,
    url: string,
    options?: { readonly ignoreError?: boolean }
  ): Promise<void> {
    try {
      const parsed = parseSetCookie(cookieStr, url)
      if (!parsed) return
      const nowSeconds = Math.floor(Date.now() / 1000)
      if (parsed.expires !== null && parsed.expires <= nowSeconds) {
        this.cookies = this.cookies.filter(
          (entry) =>
            !(
              entry.name === parsed.name &&
              entry.domain === parsed.domain &&
              entry.path === parsed.path
            )
        )
        return
      }
      this.cookies = this.cookies.filter(
        (entry) =>
          !(
            entry.name === parsed.name &&
            entry.domain === parsed.domain &&
            entry.path === parsed.path
          )
      )
      this.cookies.push(parsed)
    } catch (error) {
      if (!options?.ignoreError) throw error
    }
  }

  async getCookieString(url: string): Promise<string> {
    const matched = this.matchCookies(url)
    return matched.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
  }

  async getAllCookies(): Promise<readonly CookieEntry[]> {
    return this.cookies.map((cookie) => ({ ...cookie }))
  }

  async removeCookie(domain: string, path: string, key: string): Promise<void> {
    this.cookies = this.cookies.filter(
      (cookie) => !(cookie.domain === domain && cookie.path === path && cookie.name === key)
    )
  }

  toJSON(): string {
    return JSON.stringify(this.cookies, null, 2)
  }

  static fromJSON(serialized: string): SimpleCookieJar {
    const jar = new SimpleCookieJar()
    const parsed: unknown = JSON.parse(serialized)
    const rawList: readonly unknown[] = Array.isArray(parsed)
      ? parsed
      : isPlainRecord(parsed) && Array.isArray(parsed.cookies)
        ? parsed.cookies
        : []

    for (const item of rawList) {
      const cookie = parseStoredCookie(item)
      if (cookie) {
        jar.cookies.push(cookie)
      }
    }
    return jar
  }

  private matchCookies(url: string): MutableCookie[] {
    const parsedUrl = safeParseUrl(url)
    const host = parsedUrl?.hostname ?? ""
    const pathname = parsedUrl?.pathname ?? "/"
    const nowSeconds = Math.floor(Date.now() / 1000)

    const matched = this.cookies.filter((cookie) => {
      if (cookie.value === "") return false
      if (cookie.expires !== null && cookie.expires < nowSeconds) return false
      if (!domainMatches(cookie.domain, host)) return false
      if (!pathMatches(cookie.path, pathname)) return false
      if (!secureMatches(cookie, url)) return false
      return true
    })

    matched.sort((a, b) => b.path.length - a.path.length)
    const seen = new Set<string>()
    return matched.filter((cookie) => {
      if (seen.has(cookie.name)) return false
      seen.add(cookie.name)
      return true
    })
  }
}

export function splitSetCookieHeader(raw: string): string[] {
  if (!raw) return []
  const result: string[] = []
  let current = raw
  while (current.length > 0) {
    let splitIdx = -1
    for (let i = 0; i < current.length; i++) {
      if (current[i] === ",") {
        const after = current.slice(i + 1).trim()
        if (/^[a-zA-Z0-9_-]+=/.test(after)) {
          splitIdx = i
          break
        }
      }
    }
    if (splitIdx === -1) {
      result.push(current.trim())
      break
    }
    result.push(current.slice(0, splitIdx).trim())
    current = current.slice(splitIdx + 1).trim()
  }
  return result
}

export function extractSetCookieHeaders(
  headers: Readonly<Record<string, string | string[]>>
): string[] {
  const collected: string[] = []
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "set-cookie") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) collected.push(item)
      }
    } else if (typeof value === "string" && value.length > 0) {
      collected.push(...splitSetCookieHeader(value))
    }
  }
  return collected
}

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string
): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
}

function isRequestScopedCookie(request: HttpRequest, rawSetCookie: string): boolean {
  const eqIdx = rawSetCookie.indexOf("=")
  const cookieName = (eqIdx === -1 ? rawSetCookie : rawSetCookie.slice(0, eqIdx)).trim()
  return request.cookies?.some((entry) => entry.name === cookieName) ?? false
}

function stripBodyHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === "content-type" || lower === "content-length") continue
    next[key] = value
  }
  return next
}

function stripCookieHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  const next: Record<string, string> = {}
  if (!headers) return next
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "cookie") continue
    next[key] = value
  }
  return next
}

function matchCookieEntriesForUrl(
  entries: readonly CookieEntry[],
  url: string
): readonly CookieEntry[] {
  const parsedUrl = safeParseUrl(url)
  const host = parsedUrl?.hostname ?? ""
  const pathname = parsedUrl?.pathname ?? "/"
  const nowSeconds = Math.floor(Date.now() / 1000)

  const matched = entries
    .filter(
      (cookie) =>
        cookie.value !== "" &&
        (cookie.expires === null || cookie.expires >= nowSeconds) &&
        domainMatches(cookie.domain, host) &&
        pathMatches(cookie.path, pathname) &&
        secureMatches(cookie, url)
    )
    .sort((a, b) => b.path.length - a.path.length)

  const seen = new Set<string>()
  return matched.filter((cookie) => {
    if (seen.has(cookie.name)) return false
    seen.add(cookie.name)
    return true
  })
}

async function resolveHopCookies(
  jar: CookieJar,
  url: string,
  requestCookies: readonly CookieEntry[] | undefined
): Promise<{ readonly cookies: readonly CookieEntry[]; readonly cookieHeader: string }> {
  const allJarCookies = await jar.getAllCookies()
  const matchedJar = matchCookieEntriesForUrl(allJarCookies, url)
  const matchedScoped = requestCookies?.length ? matchCookieEntriesForUrl(requestCookies, url) : []

  if (matchedScoped.length === 0) {
    // Also honor custom CookieJar implementations that compute getCookieString directly
    if (matchedJar.length === 0) {
      const fallbackString = await jar.getCookieString(url)
      if (!fallbackString) {
        return { cookies: [], cookieHeader: "" }
      }
      const parsedUrl = safeParseUrl(url)
      const synthesized: CookieEntry[] = fallbackString
        .split("; ")
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf("=")
          const name = eq === -1 ? pair : pair.slice(0, eq)
          const value = eq === -1 ? "" : pair.slice(eq + 1)
          return {
            name,
            value,
            domain: parsedUrl?.hostname ?? "",
            path: "/",
            secure: url.startsWith("https:"),
            expires: null,
          }
        })
        .filter((entry) => entry.name.length > 0 && entry.value.length > 0)
      return { cookies: synthesized, cookieHeader: fallbackString }
    }
    return {
      cookies: matchedJar,
      cookieHeader: matchedJar.map((entry) => `${entry.name}=${entry.value}`).join("; "),
    }
  }

  const scopedNames = new Set(matchedScoped.map((entry) => entry.name))
  const combined = [...matchedJar.filter((entry) => !scopedNames.has(entry.name)), ...matchedScoped]
  return {
    cookies: combined,
    cookieHeader: combined.map((entry) => `${entry.name}=${entry.value}`).join("; "),
  }
}

async function sendHopWithJar(
  http: PluginHttpService,
  jar: CookieJar,
  hopRequest: HttpRequest,
  originalRequest: HttpRequest
): Promise<HttpResponse> {
  const { cookies, cookieHeader } = await resolveHopCookies(
    jar,
    hopRequest.url,
    originalRequest.cookies
  )
  const headers = stripCookieHeaders(hopRequest.headers)
  if (cookieHeader) {
    headers.Cookie = cookieHeader
  }

  const response = await http.send({
    method: hopRequest.method,
    url: hopRequest.url,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(cookies.length > 0 ? { cookies } : {}),
    ...(hopRequest.body !== undefined ? { body: hopRequest.body } : {}),
    redirect: "manual",
    ...(hopRequest.timeoutMs !== undefined ? { timeoutMs: hopRequest.timeoutMs } : {}),
    ...(hopRequest.signal !== undefined ? { signal: hopRequest.signal } : {}),
    ...(hopRequest.responseType !== undefined ? { responseType: hopRequest.responseType } : {}),
    ...(hopRequest.proxyTargetInHeader !== undefined
      ? { proxyTargetInHeader: hopRequest.proxyTargetInHeader }
      : {}),
  })

  const setCookies = extractSetCookieHeaders(response.headers)
  for (const sc of setCookies) {
    if (!isRequestScopedCookie(originalRequest, sc)) {
      await jar.setCookie(sc, hopRequest.url, { ignoreError: true })
    }
  }

  return response
}

export async function fetchWithCookieJar(
  http: PluginHttpService,
  jar: CookieJar,
  request: HttpRequest
): Promise<HttpResponse> {
  if (request.redirect === "manual") {
    return sendHopWithJar(http, jar, request, request)
  }

  let currentUrl = request.url
  let currentMethod = request.method
  let currentBody = request.body
  let currentHeaders = request.headers

  for (let hop = 0; hop <= MAX_COOKIE_REDIRECTS; hop++) {
    const response = await sendHopWithJar(
      http,
      jar,
      {
        method: currentMethod,
        url: currentUrl,
        headers: currentHeaders,
        cookies: request.cookies,
        body: currentBody,
        redirect: "manual",
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        responseType: request.responseType,
        proxyTargetInHeader: request.proxyTargetInHeader,
      },
      request
    )

    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = headerSingle(response.headers, "location")
    if (!location) {
      return response
    }

    if (hop === MAX_COOKIE_REDIRECTS) {
      break
    }

    currentUrl = new URL(location, currentUrl).toString()

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && currentMethod === "POST")
    ) {
      currentMethod = "GET"
      currentBody = undefined
      currentHeaders = stripBodyHeaders(currentHeaders)
    }
  }

  throw new Error(`Exceeded max redirects (${MAX_COOKIE_REDIRECTS}) for ${request.url}`)
}
