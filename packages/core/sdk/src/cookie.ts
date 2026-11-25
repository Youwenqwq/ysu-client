import type { CookieEntry, HttpRequest, HttpResponse, PluginHttpService } from "./http"

/**
 * Storage contract shared by the stateless HTTP runtime and academic sessions.
 * A `CookieJar` is deliberately transport-agnostic: callers may implement it
 * with memory, SecureStorage or a native bridge.
 */
export interface CookieJar {
  setCookie(
    cookie: string,
    url: string,
    options?: { readonly ignoreError?: boolean }
  ): Promise<void>
  getCookieString(url: string): Promise<string>
  getAllCookies(): Promise<readonly CookieEntry[]>
  removeCookie(domain: string, path: string, key: string): Promise<void>
  toJSON(): string
}

export type CookiePredicate = (entry: CookieEntry) => boolean

export const MAX_COOKIE_REDIRECTS = 10

interface StoredCookie extends CookieEntry {
  /** RFC 6265 host-only cookies must not match sibling subdomains. */
  readonly hostOnly: boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^\./, "")
}

export function safeParseUrl(url: string): URL | null {
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

/**
 * RFC 6265 §5.1.3 domain matching. The stored domain may retain a leading dot
 * for compatibility with older serialized jars.
 */
export function domainMatches(cookieDomain: string, host: string): boolean {
  if (!cookieDomain) return true
  const candidate = normalizeDomain(cookieDomain)
  const normalizedHost = host.toLowerCase()
  return normalizedHost === candidate || normalizedHost.endsWith(`.${candidate}`)
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  // RFC 6265 §5.1.4: prefix matches when cookiePath ends with '/' or the
  // request path continues with a '/' segment boundary.
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/"
}

export function secureMatches(cookie: Pick<CookieEntry, "secure">, url: string): boolean {
  if (!cookie.secure) return true
  return url.startsWith("https:") || url.startsWith("wss:")
}

function cookieDomainMatches(cookie: StoredCookie, host: string): boolean {
  if (cookie.hostOnly) return normalizeDomain(cookie.domain) === host.toLowerCase()
  return domainMatches(cookie.domain, host)
}

export function cookieEntryFromJSON(data: Record<string, unknown>): CookieEntry {
  const name = data["name"]
  if (typeof name !== "string") {
    throw new TypeError(`Cookie entry missing "name": ${JSON.stringify(data)}`)
  }
  const expiresRaw = data["expires"]
  let expires: number | null = null
  if (typeof expiresRaw === "number") {
    expires = Math.trunc(expiresRaw)
  } else if (typeof expiresRaw === "string" && expiresRaw !== "") {
    const num = Number(expiresRaw)
    if (Number.isFinite(num)) expires = Math.trunc(num)
  }
  return {
    name,
    value: typeof data["value"] === "string" ? data["value"] : "",
    domain: typeof data["domain"] === "string" ? data["domain"] : "",
    path: typeof data["path"] === "string" ? data["path"] : "/",
    secure: Boolean(data["secure"]),
    expires,
  }
}

function parseStoredCookie(item: unknown): StoredCookie | null {
  if (!isPlainRecord(item)) return null
  const name = typeof item["name"] === "string" ? item["name"] : ""
  if (!name) return null
  const entry = cookieEntryFromJSON({ ...item, name })
  return {
    ...entry,
    // Older jars did not persist hostOnly and relied on suffix matching, so
    // conservative `false` keeps their behaviour exactly stable.
    hostOnly: item["hostOnly"] === true,
  }
}

export async function collectCookies(
  jar: CookieJar,
  predicate: CookiePredicate
): Promise<CookieEntry[]> {
  const all = await jar.getAllCookies()
  return all.filter((entry) => entry.value !== "" && predicate(entry))
}

export async function installCookies(
  jar: CookieJar,
  entries: readonly CookieEntry[]
): Promise<void> {
  for (const entry of entries) {
    if (entry.value === "") continue
    const parts = [`${entry.name}=${entry.value}`]
    if (entry.domain) parts.push(`Domain=${entry.domain}`)
    if (entry.path) parts.push(`Path=${entry.path}`)
    if (entry.secure) parts.push("Secure")
    if (entry.expires !== null) {
      parts.push(`Expires=${new Date(entry.expires * 1000).toUTCString()}`)
    }
    const host = entry.domain.replace(/^\./, "") || "localhost"
    const url = `https://${host}${entry.path}`
    await jar.setCookie(parts.join("; "), url, { ignoreError: true })
  }
}

function parseSetCookie(rawCookie: string, url: string): StoredCookie | null {
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
  const host = parsedUrl?.hostname?.toLowerCase() ?? ""
  const defaultPath = defaultPathFromUrl(parsedUrl?.pathname ?? "/")

  let domain = host
  let hostOnly = true
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
      case "domain": {
        if (!val) break
        const candidate = normalizeDomain(val)
        // RFC 6265 §5.3: a Domain attribute that does not domain-match the
        // response host means the entire cookie must be ignored. This blocks
        // `evil.example` from planting `Domain=.ysu.edu.cn` cookies.
        if (!candidate || !domainMatches(candidate, host)) {
          return null
        }
        domain = `.${candidate}`
        hostOnly = false
        break
      }
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

  return { name, value, domain, path, secure, expires, hostOnly }
}

export class SimpleCookieJar implements CookieJar {
  private cookies: StoredCookie[] = []

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
    return matchCookieEntries(this.cookies, url, cookieDomainMatches)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ")
  }

  async getAllCookies(): Promise<readonly CookieEntry[]> {
    return this.cookies.map(
      (cookie): CookieEntry => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        expires: cookie.expires,
      })
    )
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
}

function matchCookieEntries<T extends CookieEntry>(
  entries: readonly T[],
  url: string,
  matchesDomain: (cookie: T, host: string) => boolean
): readonly T[] {
  const parsedUrl = safeParseUrl(url)
  const host = parsedUrl?.hostname ?? ""
  const pathname = parsedUrl?.pathname ?? "/"
  const nowSeconds = Math.floor(Date.now() / 1000)

  const matched = entries
    .filter(
      (cookie) =>
        cookie.value !== "" &&
        (cookie.expires === null || cookie.expires >= nowSeconds) &&
        matchesDomain(cookie, host) &&
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

export function splitSetCookie(raw: string): string[] {
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

export function findHeader(
  headers: Readonly<Record<string, string | string[]>> | undefined,
  name: string
): string | string[] | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  if (lower in headers) return headers[lower]
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string
): string | undefined {
  const value = findHeader(headers, name)
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

export function extractSetCookies(headers: Readonly<Record<string, string | string[]>>): string[] {
  const raw = findHeader(headers, "set-cookie")
  if (raw === undefined) return []
  if (Array.isArray(raw)) {
    return raw.flatMap((entry) => (typeof entry === "string" ? splitSetCookie(entry) : []))
  }
  return splitSetCookie(raw)
}

export function mergeScopedCookies(
  baseCookieString: string,
  url: string,
  scopedEntries: readonly CookieEntry[] | undefined
): string {
  if (!scopedEntries || scopedEntries.length === 0) return baseCookieString

  const matched = matchScopedCookieEntries(scopedEntries, url)
  const scoped = new Map<string, string>()
  for (const cookie of matched) {
    if (!scoped.has(cookie.name)) scoped.set(cookie.name, cookie.value)
  }
  if (scoped.size === 0) return baseCookieString

  const baseParts = baseCookieString.split("; ").filter((part) => {
    if (!part) return false
    const eq = part.indexOf("=")
    const name = eq === -1 ? part : part.slice(0, eq)
    return !scoped.has(name)
  })
  return [...baseParts, ...Array.from(scoped, ([name, value]) => `${name}=${value}`)].join("; ")
}

function matchScopedCookieEntries(
  entries: readonly CookieEntry[],
  url: string
): readonly CookieEntry[] {
  return matchCookieEntries(entries, url, (cookie, host) => domainMatches(cookie.domain, host))
}

export function isRequestScopedCookie(
  req: Pick<HttpRequest, "cookies">,
  cookie: string
): boolean {
  const equals = cookie.indexOf("=")
  const name = (equals === -1 ? cookie : cookie.slice(0, equals)).trim()
  return req.cookies?.some((entry) => entry.name === name) ?? false
}

export function stripBodyHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === "content-type" || lower === "content-length") continue
    out[key] = value
  }
  return out
}

function stripCookieHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "cookie") continue
    out[key] = value
  }
  return out
}

export function withCookieHeader(
  headers: Readonly<Record<string, string>> | undefined,
  cookieHeader: string
): Record<string, string> {
  const out = stripCookieHeaders(headers)
  if (cookieHeader) out["Cookie"] = cookieHeader
  return out
}

function stripCrossOriginHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> | undefined {
  if (!headers) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (lower === "authorization" || lower === "proxy-authorization") continue
    out[key] = value
  }
  return out
}

function sameOrigin(a: string, b: string): boolean {
  const left = safeParseUrl(a)
  const right = safeParseUrl(b)
  if (!left || !right) return false
  return left.origin === right.origin
}

async function resolveHopCookieHeader(
  jar: CookieJar,
  url: string,
  requestCookies: readonly CookieEntry[] | undefined
): Promise<string> {
  // The jar's serialized header is authoritative; only explicit request-scoped
  // entries need matching and replacement here.
  const jarCookieString = await jar.getCookieString(url)
  return mergeScopedCookies(jarCookieString, url, requestCookies)
}

export type HttpHopSender = (request: HttpRequest) => Promise<HttpResponse>

/**
 * Single redirect driver for every HTTP path. `sendHop` receives an already
 * scoped `HttpRequest` with `redirect: "manual"`; the driver owns URL
 * resolution, method rewriting, body stripping and cross-origin credential
 * removal so those rules cannot drift between transports.
 */
export async function followRedirects(
  request: HttpRequest,
  sendHop: HttpHopSender,
  maxRedirects: number = MAX_COOKIE_REDIRECTS
): Promise<HttpResponse> {
  let currentUrl = request.url
  let currentMethod = request.method
  let currentBody = request.body
  let currentHeaders = request.headers

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const hopRequest: HttpRequest = {
      method: currentMethod,
      url: currentUrl,
      ...(currentHeaders !== undefined ? { headers: currentHeaders } : {}),
      ...(currentBody !== undefined ? { body: currentBody } : {}),
      redirect: "manual",
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.signal !== undefined ? { signal: request.signal } : {}),
      ...(request.responseType !== undefined ? { responseType: request.responseType } : {}),
      ...(request.proxyTargetInHeader !== undefined
        ? { proxyTargetInHeader: request.proxyTargetInHeader }
        : {}),
    }

    const response = await sendHop(hopRequest)

    if (request.redirect === "manual") {
      return response
    }
    if (response.status < 300 || response.status >= 400) {
      return response
    }

    const location = headerSingle(response.headers, "location")
    if (!location) {
      return response
    }

    if (hop === maxRedirects) {
      break
    }

    const nextUrl = new URL(location, currentUrl).toString()

    // Credentials must not cross an origin boundary. Cookie headers are
    // recomputed per hop by sendHop from the target URL's cookie scope.
    if (!sameOrigin(currentUrl, nextUrl)) {
      currentHeaders = stripCrossOriginHeaders(currentHeaders)
    }

    currentUrl = nextUrl

    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && currentMethod === "POST")
    ) {
      currentMethod = "GET"
      currentBody = undefined
      currentHeaders = stripBodyHeaders(currentHeaders)
    }
  }

  throw new Error(`Exceeded max redirects (${maxRedirects}) for ${request.url}`)
}

/**
 * Follows redirects through a `PluginHttpService` while capturing `Set-Cookie`
 * into the supplied jar. Every hop recomputes the `Cookie` header from the
 * hop URL scope, including request-provided scoped cookie entries.
 */
export async function fetchWithCookieJar(
  http: PluginHttpService,
  jar: CookieJar,
  request: HttpRequest
): Promise<HttpResponse> {
  const sendHop: HttpHopSender = async (hopRequest) => {
    const cookieHeader = await resolveHopCookieHeader(jar, hopRequest.url, request.cookies)
    const headers = withCookieHeader(hopRequest.headers, cookieHeader)

    const response = await http.send({ ...hopRequest, headers })

    for (const setCookie of extractSetCookies(response.headers)) {
      if (!isRequestScopedCookie(request, setCookie)) {
        await jar.setCookie(setCookie, hopRequest.url, { ignoreError: true })
      }
    }

    return response
  }

  return followRedirects(request, sendHop)
}
