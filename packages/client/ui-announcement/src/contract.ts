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
  readonly signal?: AbortSignal
}

export interface PluginAnnouncementService {
  readonly endpoint: string | null
  check(options?: AnnouncementCheckOptions): Promise<PluginAnnouncement | null>
  dismiss(id: string): void
}

declare module "@cordisjs/core" {
  interface Context {
    announcement: PluginAnnouncementService
  }
}
