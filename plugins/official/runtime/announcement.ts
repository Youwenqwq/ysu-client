import {
  definePlugin,
  PLUGIN_API_VERSION,
  type AnnouncementCheckOptions,
  type AnnouncementLevel,
  type CompositionPlugin,
  type PluginAnnouncement,
  type PluginAnnouncementService,
  type PluginConfig,
  type PluginContext,
} from "@orahako/plugin-sdk"

export interface AnnouncementRuntimeConfig extends PluginConfig {
  /** Announcement JSON document; omit to disable announcements for this composition. */
  endpoint?: string
  /** localStorage key that persists the last dismissed announcement id. */
  dismissedStorageKey?: string
}

export interface AnnouncementStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ConfiguredAnnouncementOptions {
  endpoint?: string | null
  dismissedStorageKey?: string
  storage?: AnnouncementStorage | null
  now?: () => number
}

const DEFAULT_DISMISSED_KEY = "orahako-announcement-dismissed"
const LEVELS: readonly AnnouncementLevel[] = ["info", "warning", "critical"]

function browserStorage(): AnnouncementStorage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

/** Fetch/expiry/dismissal handling for a composition-configured document. */
export class ConfiguredAnnouncementService implements PluginAnnouncementService {
  readonly endpoint: string | null
  private readonly dismissedStorageKey: string
  private readonly storage: AnnouncementStorage | null
  private readonly memory = new Map<string, string>()
  private readonly now: () => number
  private readonly controllers = new Set<AbortController>()
  private disposed = false

  constructor({
    endpoint,
    dismissedStorageKey = DEFAULT_DISMISSED_KEY,
    storage = browserStorage(),
    now = () => Date.now(),
  }: ConfiguredAnnouncementOptions = {}) {
    const trimmed = endpoint?.trim() ?? ""
    this.endpoint = trimmed.length > 0 ? trimmed : null
    this.dismissedStorageKey = dismissedStorageKey
    this.storage = storage
    this.now = now
  }

  async check(options: AnnouncementCheckOptions = {}): Promise<PluginAnnouncement | null> {
    if (!this.endpoint || this.disposed) return null

    const controller = new AbortController()
    this.controllers.add(controller)
    try {
      const res = await fetch(this.endpoint, {
        signal: options.signal ?? controller.signal,
      })
      if (!res.ok || this.disposed) return null

      const data = (await res.json()) as Partial<PluginAnnouncement>
      if (this.disposed) return null
      if (!data.id || !data.title) return null
      if (data.publishedAt && new Date(data.publishedAt).getTime() > this.now()) return null
      if (data.expireAt && new Date(data.expireAt).getTime() <= this.now()) return null
      if (this.read() === data.id) return null

      return {
        id: data.id,
        title: data.title,
        content: data.content ?? "",
        level: LEVELS.includes(data.level as AnnouncementLevel)
          ? (data.level as AnnouncementLevel)
          : "info",
        publishedAt: data.publishedAt,
        expireAt: data.expireAt,
      }
    } catch {
      return null
    } finally {
      this.controllers.delete(controller)
    }
  }

  dismiss(id: string): void {
    if (!id) return
    this.memory.set(this.dismissedStorageKey, id)
    try {
      this.storage?.setItem(this.dismissedStorageKey, id)
    } catch {
      // The in-memory dismissal still applies for this session.
    }
  }

  /** Aborts in-flight checks and prevents later results after plugin disposal. */
  dispose(): void {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }

  private read(): string | null {
    try {
      return (
        this.storage?.getItem(this.dismissedStorageKey) ??
        this.memory.get(this.dismissedStorageKey) ??
        null
      )
    } catch {
      return this.memory.get(this.dismissedStorageKey) ?? null
    }
  }
}

const definition = definePlugin(
  (ctx: PluginContext, config: AnnouncementRuntimeConfig = {}) => {
    const service = new ConfiguredAnnouncementService({
      endpoint: config.endpoint,
      dismissedStorageKey: config.dismissedStorageKey,
    })
    ctx.set("announcement", service)
    ctx.on("dispose", () => service.dispose())
  }
)

export const announcementRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.announcement",
    name: "Announcement feed",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description:
      "Fetch, expiry filtering and dismissal for a composition-configured announcement document.",
    provides: ["announcement"],
    configSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", minLength: 1 },
        dismissedStorageKey: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  definition,
}
