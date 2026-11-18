/**
 * YSU-owned cookie and runtime narrowing helpers.
 */
import type { CookieJar } from "@orahako/academic-sdk"
import type { CookieEntry } from "@orahako/sdk"

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {}
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function headerSingle(
  headers: Readonly<Record<string, string | string[]>>,
  name: string
): string | undefined {
  const target = name.toLowerCase()
  const direct = headers[target]
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value
    }
  }
  return undefined
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
