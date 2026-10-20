import {
  splitSetCookie,
  type HttpRequest,
  type HttpResponse,
  type SimpleCookieJar,
} from "@/lib/cookie"
import { getCustomUserAgent } from "@/lib/custom-user-agent"
import { harmonyCall } from "./harmony"
import { assertHarmonyRequest } from "./harmony-policy"

interface NativeResponse {
  status: number
  headers: Record<string, string | string[]>
  bodyBase64: string
}

export async function harmonyHttpSend(
  jar: SimpleCookieJar,
  req: HttpRequest
): Promise<HttpResponse> {
  assertHarmonyRequest(req.method, req.url, req.body?.toString())
  if (req.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
  const parsed = new URL(req.url)
  parsed.hash = ""
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() !== "cookie") headers[key.toLowerCase()] = value
  }
  headers["user-agent"] ||= getCustomUserAgent()
  headers["accept"] ||= "text/html,application/json,*/*"
  headers["accept-language"] ||= "zh-CN,zh;q=0.9,en;q=0.8"
  const cookies = await jar.getCookieString(parsed.toString())
  if (cookies) headers.cookie = cookies
  const response = await harmonyCall<NativeResponse>("http.request", {
    method: req.method,
    url: parsed.toString(),
    headers,
    body: req.body?.toString(),
    timeoutMs: Math.min(req.timeoutMs ?? 30_000, 60_000),
  })
  if (req.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError")
  const normalized: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(response.headers)) normalized[key.toLowerCase()] = value
  const setCookies = normalized["set-cookie"]
  // The native bridge preserves individual Set-Cookie values, including Expires commas.
  if (setCookies) {
    for (const cookie of Array.isArray(setCookies) ? setCookies : splitSetCookie(setCookies)) {
      await jar.setCookie(cookie, parsed.toString(), { ignoreError: true })
    }
  }
  const binary = atob(response.bodyBase64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const contentType = normalized["content-type"]
  const type = Array.isArray(contentType) ? contentType[0] : contentType
  const charset = type?.match(/charset=["']?([^\s;"']+)/i)?.[1] || "utf-8"
  return {
    status: response.status,
    url: parsed.toString(),
    headers: normalized,
    text: async () => new TextDecoder(charset).decode(bytes),
    arrayBuffer: async () => bytes.buffer,
  }
}
