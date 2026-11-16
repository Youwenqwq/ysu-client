export type AnnouncementLevel = "info" | "warning" | "critical"

export interface PluginAnnouncement {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly level: AnnouncementLevel
  readonly publishedAt?: string
  readonly expireAt?: string
}

export interface AnnouncementCheckOptions {
  /** Aborts this request; service disposal aborts every request it still owns. */
  readonly signal?: AbortSignal
}

export interface PluginAnnouncementService {
  /** Configured announcement document; null when the composition disables it. */
  readonly endpoint: string | null
  /**
   * Resolves the active, non-dismissed announcement, or null. Network and
   * payload failures are folded into null so startup never fails on this call.
   */
  check(options?: AnnouncementCheckOptions): Promise<PluginAnnouncement | null>
  /** Persists the dismissal for `id`; later checks ignore that announcement. */
  dismiss(id: string): void
}
