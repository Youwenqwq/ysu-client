import type { ObservableSource } from "@orahako/sdk"

export type AnalyticsTrackReason = "sent" | "disabled" | "duplicate" | "unavailable" | "failed"

export interface AnalyticsTrackOptions {
  readonly enabled: boolean
  readonly oncePerDay?: boolean
  readonly dedupeKey?: string
}

export interface AnalyticsTrackResult {
  readonly tracked: boolean
  readonly reason: AnalyticsTrackReason
  readonly date: string | null
}

export interface PluginAnalyticsService {
  readonly endpoint: string | null
  readonly consent: ObservableSource<boolean>
  setConsent(enabled: boolean): void
  track(
    payload: Readonly<Record<string, unknown>>,
    options: AnalyticsTrackOptions
  ): Promise<AnalyticsTrackResult>
}

declare module "@cordisjs/core" {
  interface Context {
    analytics: PluginAnalyticsService
  }
}
