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
export type NetworkActivityCategory =
  | "auth"
  | "academic"
  | "mobile"
  | "one-stop"
  | "campus"
  | "payment"
  | "wechat"
  | "other"

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

export interface NetworkActivitySnapshot {
  readonly active: readonly NetworkActivityEntry[]
  readonly session: NetworkActivitySession | null
  readonly revision: number
}

/**
 * Read-only host network activity. Subscribers observe request starts, ends
 * and burst summaries; they cannot inspect URLs or alter transport behavior.
 */
export interface PluginHttpActivityService {
  getSnapshot(): NetworkActivitySnapshot
  subscribe(listener: () => void): () => void
  /**
   * Registers a provider-scoped URL labeler. It runs synchronously before the
   * URL is discarded and must return an i18n key registered by the plugin, or
   * undefined to fall back to the generic category. First matching labeler wins.
   */
  registerLabeler(labeler: (url: string) => string | undefined): () => void
}

export interface PluginHttpService {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  activity: PluginHttpActivityService
}

export interface PluginAssetService {
  url(path: string): string | undefined
}

export type PluginNotificationChannel = "grades" | "exams" | "schedule"

export interface PluginNotificationService {
  /** Registers the channel for the current plugin; disposing the token unregisters it. */
  register(channel: PluginNotificationChannel): () => void
  getSnapshot(): readonly PluginNotificationChannel[]
  subscribe(listener: () => void): () => void
}

export interface PluginLifecycleService {
  /** Runs after every provider initialization; late subscribers are scheduled immediately. */
  onProviderReady(listener: () => void | Promise<void>): () => void
}

export interface PluginNativeService {
  readonly isNative: boolean
  saveImage(image: Blob, fileName?: string): Promise<{ uri: string }>
  requestNotificationPermission(): Promise<boolean>
  requestExactAlarmPermission(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<boolean>
}
