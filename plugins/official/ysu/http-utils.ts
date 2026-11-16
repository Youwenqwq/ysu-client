/**
 * YSU-owned cookie helpers.
 *
 * The plugin SDK exposes cookie/transport types but not the cookie helper
 * functions the host used to export. These are pure, testable equivalents that
 * operate on the public `CookieJar` interface.
 */
import type { CookieEntry, CookieJar } from "@orahako/plugin-sdk"

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()]
  if (value === undefined) return undefined
  return Array.isArray(value) ? value[0] : value
}

export function cookieEntryFromJSON(data: Record<string, unknown>): CookieEntry {
  const name = data["name"]
  if (typeof name !== "string") {
    throw new TypeError(`cookie entry missing "name": ${JSON.stringify(data)}`)
  }
  const expiresRaw = data["expires"]
  let expires: number | null = null
  if (typeof expiresRaw === "number") {
    expires = Math.trunc(expiresRaw)
  } else if (typeof expiresRaw === "string" && expiresRaw !== "") {
    const parsed = Number(expiresRaw)
    if (Number.isFinite(parsed)) expires = Math.trunc(parsed)
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
