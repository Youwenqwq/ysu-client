export interface CookieEntry {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path: string
  readonly secure: boolean
  /** Epoch seconds; null is a session cookie. */
  readonly expires: number | null
}

export interface HttpRequest {
  readonly method: "GET" | "POST"
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  readonly cookies?: readonly CookieEntry[]
  readonly body?: string | URLSearchParams
  readonly redirect: "manual" | "follow"
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly responseType?: string
  readonly proxyTargetInHeader?: boolean
}

export interface HttpResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string | string[]>>
  readonly url: string
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}
