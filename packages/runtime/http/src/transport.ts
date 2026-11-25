import { CapacitorHttp, type HttpOptions, type HttpResponseType } from "@capacitor/core"
import {
  extractSetCookies,
  followRedirects,
  isCapacitor,
  isRequestScopedCookie,
  MAX_COOKIE_REDIRECTS,
  mergeScopedCookies,
  SimpleCookieJar,
  splitSetCookie,
  withCookieHeader,
  type HttpRequest,
  type HttpResponse,
} from "@orahako/sdk"

export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_REDIRECTS = MAX_COOKIE_REDIRECTS
export const DEFAULT_PROXY_PATH = "/api/proxy"

const DEFAULT_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
const DEFAULT_ACCEPT_LANGUAGE = "zh-CN,zh;q=0.9,en;q=0.8"

export interface TransportOptions {
  readonly proxyPath?: string
  readonly isNative?: () => boolean
}

function defaultUserAgent(): string {
  return typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
    ? navigator.userAgent
    : ""
}

function stripUrlFragment(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString()
  } catch {
    const hashIndex = url.indexOf("#")
    return hashIndex === -1 ? url : url.slice(0, hashIndex)
  }
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

function extractHeaderCookie(headers: Readonly<Record<string, string>> | undefined): string {
  if (!headers) return ""
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "cookie") return value
  }
  return ""
}

function resolveCapacitorResponseType(raw: string | undefined): HttpResponseType {
  switch (raw) {
    case "arraybuffer":
    case "blob":
    case "json":
    case "text":
    case "document":
      return raw
    case "base64":
      return "arraybuffer"
    default:
      return "text"
  }
}

async function proxyHttpSend(req: HttpRequest, proxyPath: string): Promise<HttpResponse> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    const lower = key.toLowerCase()
    if (lower === "cookie") continue
    if (lower === "user-agent") {
      headers.set("x-proxy-ua", value)
    } else if (lower === "referer") {
      headers.set("x-proxy-referer", value)
    } else if (lower === "origin") {
      headers.set("x-proxy-origin", value)
    } else if (
      lower === "accept-encoding" ||
      lower === "host" ||
      lower === "content-length" ||
      lower === "connection"
    ) {
      continue
    } else {
      headers.set(key, value)
    }
  }

  if (!headers.has("x-proxy-ua")) {
    const ua = defaultUserAgent()
    if (ua) headers.set("x-proxy-ua", ua)
  }
  if (!headers.has("accept")) {
    headers.set("accept", DEFAULT_ACCEPT)
  }
  if (!headers.has("accept-language")) {
    headers.set("accept-language", DEFAULT_ACCEPT_LANGUAGE)
  }

  const cookieHeader = mergeScopedCookies(extractHeaderCookie(req.headers), req.url, req.cookies)
  if (cookieHeader) {
    headers.set("x-proxy-cookie", cookieHeader)
  }
  headers.set("x-proxy-manual-redirect", "1")

  const targetUrl = stripUrlFragment(req.url)
  let proxyUrl = proxyPath
  if (req.proxyTargetInHeader) {
    headers.set("x-proxy-target", targetUrl)
  } else {
    const separator = proxyPath.includes("?") ? "&" : "?"
    proxyUrl = `${proxyPath}${separator}url=${encodeURIComponent(targetUrl)}`
  }

  const timeoutSignal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const response = await fetch(proxyUrl, {
    method: req.method,
    headers,
    body: req.body,
    redirect: "follow",
    signal: req.signal ? AbortSignal.any([timeoutSignal, req.signal]) : timeoutSignal,
  })

  let parsedSetCookies: string[] = []
  const encodedSetCookie = response.headers.get("x-proxy-set-cookie")
  if (encodedSetCookie) {
    try {
      const b64 = encodedSetCookie.split(", ").join("")
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const setCookies: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (Array.isArray(setCookies)) {
        parsedSetCookies = setCookies.filter((item): item is string => typeof item === "string")
      }
    } catch {
      // Malformed proxy Set-Cookie chunk is ignored safely.
    }
  }

  const respHeaders: Record<string, string | string[]> = {}
  for (const [key, value] of response.headers.entries()) {
    const lower = key.toLowerCase()
    if (lower === "x-proxy-set-cookie" || lower === "x-proxy-status") continue
    if (lower.startsWith("access-control-")) continue
    respHeaders[lower] = value
  }
  if (parsedSetCookies.length > 0) {
    respHeaders["set-cookie"] = parsedSetCookies
  }

  const realStatus = Number(response.headers.get("x-proxy-status")) || response.status

  return {
    status: realStatus,
    headers: respHeaders,
    url: req.url,
    text: () => response.clone().text(),
    arrayBuffer: () => response.clone().arrayBuffer(),
  }
}

async function capacitorHttpSend(req: HttpRequest): Promise<HttpResponse> {
  if (typeof CapacitorHttp?.request !== "function") {
    throw new Error("CapacitorHttp not available")
  }
  if (req.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError")
  }

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() === "cookie") continue
    headers[key] = value
  }

  const cookieHeader = mergeScopedCookies(extractHeaderCookie(req.headers), req.url, req.cookies)
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader
  }
  if (!hasHeader(headers, "User-Agent")) {
    const ua = defaultUserAgent()
    if (ua) headers["User-Agent"] = ua
  }
  if (!hasHeader(headers, "Accept")) {
    headers["Accept"] = DEFAULT_ACCEPT
  }
  if (!hasHeader(headers, "Accept-Language")) {
    headers["Accept-Language"] = DEFAULT_ACCEPT_LANGUAGE
  }

  const options: HttpOptions = {
    method: req.method,
    url: req.url,
    headers,
    connectTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    readTimeout: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    disableRedirects: true,
    responseType: resolveCapacitorResponseType(req.responseType),
    ...(req.body !== undefined
      ? { data: req.body instanceof URLSearchParams ? req.body.toString() : req.body }
      : {}),
  }

  const response = await CapacitorHttp.request(options)

  // CapacitorHttp preserves upstream header casing; normalize all keys to lowercase.
  const rawHeaders: Readonly<Record<string, unknown>> = response.headers ?? {}
  const normalizedHeaders: Record<string, string | string[]> = {}
  for (const [key, rawVal] of Object.entries(rawHeaders)) {
    const lower = key.toLowerCase()
    if (lower === "set-cookie") {
      const parsed = Array.isArray(rawVal)
        ? rawVal.flatMap((item) => (typeof item === "string" ? splitSetCookie(item) : []))
        : typeof rawVal === "string"
          ? splitSetCookie(rawVal)
          : []
      if (parsed.length > 0) {
        normalizedHeaders["set-cookie"] = parsed
      }
    } else if (Array.isArray(rawVal)) {
      normalizedHeaders[lower] = rawVal.filter((item): item is string => typeof item === "string")
    } else if (typeof rawVal === "string") {
      normalizedHeaders[lower] = rawVal
    }
  }

  const isBase64 =
    req.responseType === "arraybuffer" ||
    req.responseType === "blob" ||
    req.responseType === "base64"

  return {
    status: response.status,
    headers: normalizedHeaders,
    url: response.url || req.url,
    text: async () => {
      const data: unknown = response.data
      if (data === null || data === undefined) return ""
      if (typeof data === "string") return data
      if (typeof data === "object") return JSON.stringify(data)
      return String(data)
    },
    arrayBuffer: async () => {
      const data: unknown = response.data
      if (isBase64) {
        const binary = atob(String(data ?? ""))
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        return bytes.buffer
      }
      const encoder = new TextEncoder()
      return encoder.encode(String(data ?? "")).buffer
    },
  }
}

export async function executeTransportHop(
  req: HttpRequest,
  options?: TransportOptions
): Promise<HttpResponse> {
  const native = (options?.isNative ?? isCapacitor)()
  if (native) {
    return capacitorHttpSend(req)
  }
  const proxyPath = options?.proxyPath ?? DEFAULT_PROXY_PATH
  return proxyHttpSend(req, proxyPath)
}

export async function executeStatelessTransport(
  req: HttpRequest,
  options?: TransportOptions
): Promise<HttpResponse> {
  if (req.redirect === "manual") {
    return executeTransportHop(req, options)
  }

  const ephemeralJar = new SimpleCookieJar()
  const initialCookie = extractHeaderCookie(req.headers)
  if (initialCookie) {
    for (const pair of initialCookie.split(";")) {
      const trimmed = pair.trim()
      if (trimmed) {
        await ephemeralJar.setCookie(trimmed, req.url, { ignoreError: true })
      }
    }
  }

  return followRedirects(req, async (hopRequest) => {
    const jarCookie = await ephemeralJar.getCookieString(hopRequest.url)
    const cookieHeader = mergeScopedCookies(jarCookie, hopRequest.url, req.cookies)
    const headers = withCookieHeader(hopRequest.headers, cookieHeader)

    const response = await executeTransportHop({ ...hopRequest, headers }, options)

    for (const setCookie of extractSetCookies(response.headers)) {
      if (!isRequestScopedCookie(req, setCookie)) {
        await ephemeralJar.setCookie(setCookie, hopRequest.url, { ignoreError: true })
      }
    }

    return response
  })
}
