import type { PluginKeyValueStorage } from "@orahako/sdk"
import type {
  AnalyticsTrackOptions,
  AnalyticsTrackResult,
  PluginAnalyticsService,
} from "./contract"

export const DEFAULT_DEDUPE_STORAGE_PREFIX = "dedupe"

export interface ConfiguredAnalyticsOptions {
  readonly endpoint?: string | null
  readonly storageKeyPrefix?: string
  readonly storage?: Pick<PluginKeyValueStorage, "getItem" | "setItem"> | null
  readonly now?: () => Date
  readonly fetchImpl?: typeof fetch
}

export class ConfiguredAnalyticsService implements PluginAnalyticsService {
  readonly endpoint: string | null
  private readonly storageKeyPrefix: string
  private readonly storage: Pick<PluginKeyValueStorage, "getItem" | "setItem"> | null
  private readonly memory = new Map<string, string>()
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly now: () => Date
  private readonly fetchImpl: typeof fetch
  private disposed = false

  constructor({
    endpoint,
    storageKeyPrefix = DEFAULT_DEDUPE_STORAGE_PREFIX,
    storage = null,
    now = () => new Date(),
    fetchImpl = (...args) => fetch(...args),
  }: ConfiguredAnalyticsOptions = {}) {
    const trimmed = endpoint?.trim() ?? ""
    this.endpoint = trimmed.length > 0 ? trimmed : null
    this.storageKeyPrefix = storageKeyPrefix
    this.storage = storage
    this.now = now
    this.fetchImpl = fetchImpl
  }

  async track(
    payload: Readonly<Record<string, unknown>>,
    options: AnalyticsTrackOptions
  ): Promise<AnalyticsTrackResult> {
    if (!options.enabled) {
      return { tracked: false, reason: "disabled", date: null }
    }
    if (!this.endpoint || this.disposed) {
      return { tracked: false, reason: "unavailable", date: null }
    }

    const endpoint = this.endpoint
    const date = this.now().toISOString().split("T")[0]!
    const watchKey = `${this.storageKeyPrefix}:${options.dedupeKey ?? "default"}`

    if (!options.oncePerDay) {
      return this.sendPayload(endpoint, payload, null, undefined)
    }

    if (this.memory.get(watchKey) === date) {
      return { tracked: false, reason: "duplicate", date }
    }

    return this.runWithKeyLock(watchKey, async (): Promise<AnalyticsTrackResult> => {
      if (this.disposed) {
        return { tracked: false, reason: "unavailable", date: null }
      }
      if (this.memory.get(watchKey) === date) {
        return { tracked: false, reason: "duplicate", date }
      }
      const persistedDate = await this.readPersisted(watchKey)
      if (persistedDate === date) {
        this.memory.set(watchKey, date)
        return { tracked: false, reason: "duplicate", date }
      }
      if (this.disposed) {
        return { tracked: false, reason: "unavailable", date: null }
      }
      return this.sendPayload(endpoint, payload, date, watchKey)
    })
  }

  dispose(): void {
    this.disposed = true
  }

  private async sendPayload(
    endpoint: string,
    payload: Readonly<Record<string, unknown>>,
    date: string | null,
    watchKey: string | undefined
  ): Promise<AnalyticsTrackResult> {
    try {
      await this.fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (watchKey && date) {
        this.memory.set(watchKey, date)
        await this.writePersisted(watchKey, date)
      }
      return {
        tracked: true,
        reason: "sent",
        date,
      }
    } catch {
      return { tracked: false, reason: "failed", date: null }
    }
  }

  private async readPersisted(key: string): Promise<string | null> {
    if (!this.storage) return null
    try {
      return await this.storage.getItem(key)
    } catch {
      return null
    }
  }

  private async writePersisted(key: string, value: string): Promise<void> {
    if (!this.storage || this.disposed) return
    try {
      await this.storage.setItem(key, value)
    } catch {
      // Storage failures do not invalidate the in-memory daily watch.
    }
  }

  private runWithKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(fn)
    this.locks.set(key, current)
    void current.finally(() => {
      if (this.locks.get(key) === current) {
        this.locks.delete(key)
      }
    })
    return current
  }
}
