import type { HttpRequest, HttpResponse } from "./http"

export interface PluginKeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PluginStorageService {
  local: PluginKeyValueStorage
  secure: PluginKeyValueStorage
}

/** Coarse host-transport category; no URL, host, query or headers are exposed. */
export type NetworkActivityCategory = string

export interface NetworkActivityEntry {
  readonly id: number
  readonly category: NetworkActivityCategory
  /**
   * Provider-registered i18n key for a finer request flow. Undefined when the
   * generic category is the best available description.
   */
  readonly label?: string
  readonly method: "GET" | "POST"
  /** Monotonic milliseconds from performance.now(). */
  readonly startedAt: number
}

/**
 * Wall-clock summary for one burst of host requests. A burst ends after a
 * short idle gap; `totalMs` spans the first start to the last finish.
 */
export interface NetworkActivitySession {
  readonly startedAt: number
  readonly endedAt: number
  readonly totalMs: number
  readonly count: number
  readonly failed: number
  /** Longest category span in the burst, including sequential steps in that category. */
  readonly slowestCategory: NetworkActivityCategory | null
  /** Provider i18n key for the slowest span, when the labeler matched it. */
  readonly slowestLabel?: string
  readonly slowestMs: number
}

export type NetworkActivityOutcome = "ok" | "error" | "aborted"

export interface NetworkActivityRecord {
  readonly id: number
  readonly category: NetworkActivityCategory
  /** Provider-registered i18n key for a finer request flow. */
  readonly label?: string
  readonly method: "GET" | "POST"
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
  readonly outcome: NetworkActivityOutcome
}

export interface NetworkActivitySnapshot {
  readonly active: readonly NetworkActivityEntry[]
  /** Completed requests for the current burst, oldest first. */
  readonly history: readonly NetworkActivityRecord[]
  readonly session: NetworkActivitySession | null
  readonly revision: number
}

/**
 * Transport-side activity recorder.
 *
 * The HTTP service owns one recorder per service instance; transports accept
 * it explicitly so instrumentation follows the owning instance instead of
 * module-global state. Plugin consumers read activity through
 * `PluginHttpActivityService`; `beginRequest` is the host transport hook.
 */
export interface NetworkActivitySink {
  /**
   * Starts tracking one logical transport request and returns an idempotent
   * finisher. The recorder must never throw into the transport.
   */
  beginRequest(url: string, method: "GET" | "POST"): (outcome?: NetworkActivityOutcome) => void
}

/**
 * Read-only host network activity. Subscribers observe request starts, ends
 * and burst summaries; they cannot inspect URLs or alter transport behavior.
 */
export interface PluginHttpActivityService extends NetworkActivitySink {
  getSnapshot(): NetworkActivitySnapshot
  subscribe(listener: () => void): () => void
  /**
   * Registers a provider-scoped URL labeler. It runs synchronously before the
   * URL is discarded and must return an i18n key registered by the plugin, or
   * undefined to fall back to the generic category. First matching labeler wins.
   */
  registerLabeler(labeler: (url: string) => string | undefined): () => void
  /** Registers a provider-owned coarse category classifier. */
  registerClassifier(classifier: (url: string) => NetworkActivityCategory | undefined): () => void
}

export interface PluginHttpService {
  /** Stateless request through the native transport or same-origin Web proxy. */
  send(request: HttpRequest): Promise<HttpResponse>
  activity: PluginHttpActivityService
}

export interface PluginAssetService {
  url(path: string): string | undefined
}

export type PluginNotificationChannel = string

export interface PluginNotificationService {
  /** Registers the channel for the current plugin; disposing the token unregisters it. */
  register(channel: PluginNotificationChannel): () => void
  getSnapshot(): readonly PluginNotificationChannel[]
  subscribe(listener: () => void): () => void
}

export interface NativeCapabilityDescriptor {
  readonly id: string
  readonly version: number
  readonly methods: readonly string[]
  readonly config?: Readonly<Record<string, unknown>>
}

export interface PluginNativeCapabilityService {
  list(): readonly NativeCapabilityDescriptor[]
  has(id: string): boolean
  acquire(id: string, config?: Record<string, unknown>): Promise<() => Promise<void>>
  invoke<T>(id: string, method: string, payload?: Record<string, unknown>): Promise<T>
}

export interface PluginNativeService {
  readonly isNative: boolean
  readonly capabilities: PluginNativeCapabilityService
  saveImage(image: Blob, fileName?: string): Promise<{ uri: string }>
  requestNotificationPermission(): Promise<boolean>
  requestExactAlarmPermission(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<boolean>
}
