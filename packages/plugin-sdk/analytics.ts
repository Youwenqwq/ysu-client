/**
 * Generic anonymous usage reporting. The collector endpoint is supplied by the
 * active composition, never by the service implementation or the kernel.
 */
export type AnalyticsTrackReason = "sent" | "disabled" | "duplicate" | "unavailable" | "failed"

export interface AnalyticsTrackOptions {
  /** Caller-owned consent decision. False skips both storage and network. */
  readonly enabled: boolean
  /** Suppress repeats of the same `dedupeKey` within one UTC day. */
  readonly oncePerDay?: boolean
  /** Names the daily watch; defaults to the payload's implicit "default" slot. */
  readonly dedupeKey?: string
}

export interface AnalyticsTrackResult {
  readonly tracked: boolean
  readonly reason: AnalyticsTrackReason
  /** UTC date used by the daily gate, when one applied. */
  readonly date: string | null
}

export interface PluginAnalyticsService {
  /** Configured collector endpoint; null when the composition disables analytics. */
  readonly endpoint: string | null
  /**
   * POSTs one JSON payload to the configured collector. Transport failures are
   * reported in the result and never reject, so analytics cannot block startup.
   */
  track(
    payload: Readonly<Record<string, unknown>>,
    options: AnalyticsTrackOptions
  ): Promise<AnalyticsTrackResult>
}
