import type { PluginKeyValueStorage } from "@orahako/sdk"
import type {
  AnnouncementCheckOptions,
  AnnouncementLevel,
  PluginAnnouncement,
  PluginAnnouncementService,
} from "./contract"

export const DEFAULT_DISMISSED_STORAGE_KEY = "dismissed-id"

const VALID_LEVELS: readonly AnnouncementLevel[] = ["info", "warning", "critical"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidAnnouncementLevel(value: unknown): value is AnnouncementLevel {
  return typeof value === "string" && VALID_LEVELS.some((level) => level === value)
}

export interface ConfiguredAnnouncementOptions {
  readonly endpoint?: string | null
  readonly dismissedStorageKey?: string
  readonly storage?: Pick<PluginKeyValueStorage, "getItem" | "setItem"> | null
  readonly now?: () => number
  readonly fetchImpl?: typeof fetch
}

export class ConfiguredAnnouncementService implements PluginAnnouncementService {
  readonly endpoint: string | null
  private readonly dismissedStorageKey: string
  private readonly storage: Pick<PluginKeyValueStorage, "getItem" | "setItem"> | null
  private readonly now: () => number
  private readonly fetchImpl: typeof fetch
  private readonly controllers = new Set<AbortController>()
  private memoryDismissedId: string | null = null
  private mutatedMemory = false
  private hydrated = false
  private hydrationPromise: Promise<void> | null = null
  private disposed = false

  constructor({
    endpoint,
    dismissedStorageKey = DEFAULT_DISMISSED_STORAGE_KEY,
    storage = null,
    now = () => Date.now(),
    fetchImpl = (...args) => fetch(...args),
  }: ConfiguredAnnouncementOptions = {}) {
    const trimmed = endpoint?.trim() ?? ""
    this.endpoint = trimmed.length > 0 ? trimmed : null
    this.dismissedStorageKey = dismissedStorageKey
    this.storage = storage
    this.now = now
    this.fetchImpl = fetchImpl
  }

  async check(options: AnnouncementCheckOptions = {}): Promise<PluginAnnouncement | null> {
    if (!this.endpoint || this.disposed) return null
    if (options.signal?.aborted) return null

    await this.ensureHydrated()
    if (this.disposed || options.signal?.aborted) return null

    const controller = new AbortController()
    this.controllers.add(controller)

    const onExternalAbort = () => controller.abort()
    options.signal?.addEventListener("abort", onExternalAbort, { once: true })

    try {
      const response = await this.fetchImpl(this.endpoint, {
        signal: controller.signal,
      })
      if (!response.ok || this.disposed) return null

      const raw: unknown = await response.json()
      if (this.disposed || !isRecord(raw)) return null

      const id = typeof raw.id === "string" ? raw.id : ""
      const title = typeof raw.title === "string" ? raw.title : ""
      if (!id || !title) return null

      const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt : undefined
      const expireAt = typeof raw.expireAt === "string" ? raw.expireAt : undefined

      if (publishedAt && new Date(publishedAt).getTime() > this.now()) return null
      if (expireAt && new Date(expireAt).getTime() <= this.now()) return null
      if (this.memoryDismissedId === id) return null

      const content = typeof raw.content === "string" ? raw.content : ""
      const level: AnnouncementLevel = isValidAnnouncementLevel(raw.level) ? raw.level : "info"

      return {
        id,
        title,
        content,
        level,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        ...(expireAt !== undefined ? { expireAt } : {}),
      }
    } catch {
      return null
    } finally {
      options.signal?.removeEventListener("abort", onExternalAbort)
      this.controllers.delete(controller)
    }
  }

  dismiss(id: string): void {
    if (!id) return
    this.mutatedMemory = true
    this.memoryDismissedId = id
    if (!this.storage || this.disposed) return
    void Promise.resolve()
      .then(() => this.storage?.setItem(this.dismissedStorageKey, id))
      .catch(() => {
        // Synchronous memory mirror still applies for the active session.
      })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()
  }

  private ensureHydrated(): Promise<void> {
    if (this.hydrated || !this.storage) {
      this.hydrated = true
      return Promise.resolve()
    }
    if (!this.hydrationPromise) {
      this.hydrationPromise = Promise.resolve()
        .then(() => this.storage?.getItem(this.dismissedStorageKey))
        .then((stored) => {
          if (!this.mutatedMemory && typeof stored === "string" && stored.length > 0) {
            this.memoryDismissedId = stored
          }
        })
        .catch(() => {
          // Unavailable storage falls back to in-memory dismissal mirror.
        })
        .finally(() => {
          this.hydrated = true
        })
    }
    return this.hydrationPromise
  }
}
