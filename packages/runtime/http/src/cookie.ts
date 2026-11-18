import type { CookieEntry, HttpRequest } from "@orahako/sdk"

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

export type CookiePredicate = (entry: CookieEntry) => boolean

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

interface SimpleCookie {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  expires: number | null
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

export function domainMatches(cookieDomain: string, host: string): boolean {
  if (!cookieDomain) return true
  const cd = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain
  const h = host.toLowerCase()
  return h === cd || h.endsWith("." + cd)
}

export function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (!cookiePath || cookiePath === "/") return true
  if (requestPath === cookiePath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  // RFC 6265 §5.1.4: prefix matches when cookiePath ends with '/' or next char in requestPath is '/'.
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/"
}

export function secureMatches(cookie: { readonly secure: boolean }, url: string): boolean {
  if (!cookie.secure) return true
  return url.startsWith("https:") || url.startsWith("wss:")
}

function parseSetCookie(str: string, url: string): SimpleCookie | null {
  const trimmed = str.trim()
  if (!trimmed) return null

  const firstSemi = trimmed.indexOf(";")
  const nameValue = firstSemi === -1 ? trimmed : trimmed.slice(0, firstSemi)
  const rest = firstSemi === -1 ? "" : trimmed.slice(firstSemi + 1)

  const eqIdx = nameValue.indexOf("=")
  const name = eqIdx === -1 ? nameValue.trim() : nameValue.slice(0, eqIdx).trim()
  const value = eqIdx === -1 ? "" : nameValue.slice(eqIdx + 1).trim()

  if (!name) return null

  const parsedUrl = safeParseUrl(url)
  const defaultDomain = parsedUrl?.hostname ?? ""
  const defaultPath = defaultPathFromUrl(parsedUrl?.pathname ?? "/")

  let domain = defaultDomain
  let path = defaultPath
  let secure = false
  let expires: number | null = null

  const attrs = rest.split(";")
  for (const attr of attrs) {
    const parts = attr.split("=", 2)
    const rawKey = parts[0] ?? ""
    const rawVal = parts[1]
    const key = rawKey.trim().toLowerCase()
    const val = rawVal === undefined ? "" : rawVal.trim()

    switch (key) {
      case "domain":
        if (val) {
          domain = val.toLowerCase()
          if (!domain.startsWith(".")) {
            domain = "." + domain
          }
        }
        break
      case "path":
        if (val && val.startsWith("/")) {
          path = val
        }
        break
      case "expires": {
        const d = new Date(val)
        if (!Number.isNaN(d.getTime())) {
          expires = Math.floor(d.getTime() / 1000)
        }
        break
      }
      case "max-age": {
        const seconds = Number(val)
        if (Number.isFinite(seconds)) {
          expires = Math.floor(Date.now() / 1000) + seconds
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

export class SimpleCookieJar implements CookieJar {
  private cookies: SimpleCookie[] = []

  async setCookie(
    cookieStr: string,
    url: string,
    options?: { readonly ignoreError?: boolean }
  ): Promise<void> {
    try {
      const parsed = parseSetCookie(cookieStr, url)
      if (!parsed) return
      if (parsed.expires !== null && parsed.expires <= Math.floor(Date.now() / 1000)) {
        // Max-Age <= 0 or already-expired Set-Cookie deletes matching name+domain+path.
        this.cookies = this.cookies.filter(
          (c) => !(c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path)
        )
        return
      }
      this.cookies = this.cookies.filter(
        (c) => !(c.name === parsed.name && c.domain === parsed.domain && c.path === parsed.path)
      )
      this.cookies.push(parsed)
    } catch (error) {
      if (!options?.ignoreError) throw error
    }
  }

  async getCookieString(url: string): Promise<string> {
    const parsedUrl = safeParseUrl(url)
    const host = parsedUrl?.hostname ?? ""
    const pathname = parsedUrl?.pathname ?? "/"
    const now = Math.floor(Date.now() / 1000)

    const matched = this.cookies.filter((c) => {
      if (c.value === "") return false
      if (c.expires !== null && c.expires < now) return false
      if (!domainMatches(c.domain, host)) return false
      if (!pathMatches(c.path, pathname)) return false
      if (!secureMatches(c, url)) return false
      return true
    })

    // Longest path wins when deduplicating same-named cookies.
    matched.sort((a, b) => b.path.length - a.path.length)
    const seen = new Set<string>()
    const deduped = matched.filter((c) => {
      if (seen.has(c.name)) return false
      seen.add(c.name)
      return true
    })
    return deduped.map((c) => `${c.name}=${c.value}`).join("; ")
  }

  async getAllCookies(): Promise<readonly CookieEntry[]> {
    return this.cookies.map((c) => ({ ...c }))
  }

  async removeCookie(domain: string, path: string, key: string): Promise<void> {
    this.cookies = this.cookies.filter(
      (c) => !(c.domain === domain && c.path === path && c.name === key)
    )
  }

  toJSON(): string {
    return JSON.stringify(this.cookies, null, 2)
  }

  static fromJSON(serialized: string): SimpleCookieJar {
    const jar = new SimpleCookieJar()
    const data: unknown = JSON.parse(serialized)
    if (!Array.isArray(data)) return jar
    for (const item of data) {
      if (!isRecord(item)) continue
      const name = typeof item["name"] === "string" ? item["name"] : ""
      if (!name) continue
      const entry = cookieEntryFromJSON({ ...item, name })
      jar.cookies.push({
        name: entry.name,
        value: entry.value,
        domain: entry.domain,
        path: entry.path,
        secure: entry.secure,
        expires: entry.expires,
      })
    }
    return jar
  }
}

export function splitSetCookie(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
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
      out.push(current.trim())
      break
    }
    out.push(current.slice(0, splitIdx).trim())
    current = current.slice(splitIdx + 1).trim()
  }
  return out
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

  const parsedUrl = safeParseUrl(url)
  const host = parsedUrl?.hostname ?? ""
  const pathname = parsedUrl?.pathname ?? "/"
  const now = Math.floor(Date.now() / 1000)

  const matched = scopedEntries
    .filter(
      (cookie) =>
        cookie.value !== "" &&
        (cookie.expires === null || cookie.expires >= now) &&
        domainMatches(cookie.domain, host) &&
        pathMatches(cookie.path, pathname) &&
        secureMatches(cookie, url)
    )
    .sort((a, b) => b.path.length - a.path.length)

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

export function isRequestScopedCookie(req: Pick<HttpRequest, "cookies">, cookie: string): boolean {
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
