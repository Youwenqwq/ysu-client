import type { Context } from "@cordisjs/core"
import type { ObservableSource } from "./observable"

export type HttpValuePipelineContext = Pick<Context, "lifecycle">

/**
 * Runs the Cordis `waterfall` hook type locally for HTTP values. Cordis 3.18
 * does not ship `Lifecycle.waterfall`/`Context.waterfall`; the HTTP runtime
 * only needs this replacement-threading behavior on its two transport events.
 */
async function runHttpValuePipeline<T>(
  ctx: HttpValuePipelineContext,
  event: "http/request" | "http/response",
  value: T,
  ...rest: unknown[]
): Promise<T> {
  const args: unknown[] = [event, value, ...rest]
  const iterator = ctx.lifecycle.dispatch("waterfall", args)
  let step = iterator.next()
  while (!step.done) {
    const replacement = await step.value
    if (replacement !== undefined) args[0] = replacement
    step = iterator.next()
  }
  return args[0] as T
}

/** Applies every `http/request` listener in order, threading replacements. */
export function runHttpRequestPipeline(
  ctx: HttpValuePipelineContext,
  request: HttpRequest
): Promise<HttpRequest> {
  return runHttpValuePipeline(ctx, "http/request", request)
}

/**
 * Applies every `http/response` listener in order with the effective request
 * as the second argument, threading response replacements.
 */
export function runHttpResponsePipeline(
  ctx: HttpValuePipelineContext,
  response: HttpResponse,
  request: HttpRequest
): Promise<HttpResponse> {
  return runHttpValuePipeline(ctx, "http/response", response, request)
}

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

/** Coarse host-transport category; no URL, host, query or headers are exposed. */
export type NetworkActivityCategory = string

export interface NetworkActivityEntry {
  readonly id: number
  readonly category: NetworkActivityCategory
  readonly label?: string
  readonly method: "GET" | "POST"
  /** Monotonic milliseconds from performance.now(). */
  readonly startedAt: number
}

export interface NetworkActivitySession {
  readonly startedAt: number
  readonly endedAt: number
  readonly totalMs: number
  readonly count: number
  readonly failed: number
  readonly slowestCategory: NetworkActivityCategory | null
  readonly slowestLabel?: string
  readonly slowestMs: number
}

export type NetworkActivityOutcome = "ok" | "error" | "aborted"

export interface NetworkActivityRecord {
  readonly id: number
  readonly category: NetworkActivityCategory
  readonly label?: string
  readonly method: "GET" | "POST"
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
  readonly outcome: NetworkActivityOutcome
}

export interface NetworkActivitySnapshot {
  readonly active: readonly NetworkActivityEntry[]
  readonly history: readonly NetworkActivityRecord[]
  readonly session: NetworkActivitySession | null
  readonly revision: number
}

export interface NetworkActivitySink {
  beginRequest(url: string, method: "GET" | "POST"): (outcome?: NetworkActivityOutcome) => void
}

export interface PluginHttpActivityService
  extends NetworkActivitySink, ObservableSource<NetworkActivitySnapshot> {
  readonly state: ObservableSource<NetworkActivitySnapshot>
  registerLabeler(labeler: (url: string) => string | undefined): () => void
  registerClassifier(classifier: (url: string) => NetworkActivityCategory | undefined): () => void
}

export interface PluginHttpService {
  /** Stateless request through the native transport or same-origin Web proxy. */
  send(request: HttpRequest): Promise<HttpResponse>
  readonly activity: PluginHttpActivityService
}
