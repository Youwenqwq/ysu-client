import {
  definePlugin,
  PLUGIN_API_VERSION,
  type AnalyticsTrackOptions,
  type AnalyticsTrackResult,
  type CompositionPlugin,
  type PluginAnalyticsService,
  type PluginConfig,
  type PluginContext,
} from "@orahako/plugin-sdk"

export interface AnalyticsRuntimeConfig extends PluginConfig {
  /** Collector URL; omit to disable analytics for this composition. */
  endpoint?: string
  /** localStorage namespace for the per-day deduplication watch. */
  storageKey?: string
}

export interface AnalyticsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ConfiguredAnalyticsOptions {
  endpoint?: string | null
  storageKey?: string
  storage?: AnalyticsStorage | null
  now?: () => Date
}

const DEFAULT_STORAGE_KEY = "orahako-analytics"

function browserStorage(): AnalyticsStorage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

/**
 * Transport-only analytics service. Consent, payload shape and event naming
 * stay with the consumer; the endpoint and daily watch are composition config.
 */
export class ConfiguredAnalyticsService implements PluginAnalyticsService {
  readonly endpoint: string | null
  private readonly storageKey: string
  private readonly storage: AnalyticsStorage | null
  private readonly memory = new Map<string, string>()
  private readonly now: () => Date

  constructor({
    endpoint,
    storageKey = DEFAULT_STORAGE_KEY,
    storage = browserStorage(),
    now = () => new Date(),
  }: ConfiguredAnalyticsOptions = {}) {
    const trimmed = endpoint?.trim() ?? ""
    this.endpoint = trimmed.length > 0 ? trimmed : null
    this.storageKey = storageKey
    this.storage = storage
    this.now = now
  }

  async track(
    payload: Readonly<Record<string, unknown>>,
    options: AnalyticsTrackOptions
  ): Promise<AnalyticsTrackResult> {
    if (!options.enabled) {
      return { tracked: false, reason: "disabled", date: null }
    }
    if (!this.endpoint) {
      return { tracked: false, reason: "unavailable", date: null }
    }

    const date = this.now().toISOString().split("T")[0]!
    const watchKey = `${this.storageKey}:${options.dedupeKey ?? "default"}`
    if (options.oncePerDay && this.read(watchKey) === date) {
      return { tracked: false, reason: "duplicate", date }
    }

    try {
      await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (options.oncePerDay) this.write(watchKey, date)
      return {
        tracked: true,
        reason: "sent",
        date: options.oncePerDay ? date : null,
      }
    } catch {
      return { tracked: false, reason: "failed", date: null }
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? this.memory.get(key) ?? null
    } catch {
      return this.memory.get(key) ?? null
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value)
    try {
      this.storage?.setItem(key, value)
    } catch {
      // Storage can be unavailable or full; the in-memory watch still applies.
    }
  }
}

const definition = definePlugin(
  (ctx: PluginContext, config: AnalyticsRuntimeConfig = {}) => {
    const service = new ConfiguredAnalyticsService({
      endpoint: config.endpoint,
      storageKey: config.storageKey,
    })
    ctx.set("analytics", service)
  }
)

export const analyticsRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.analytics",
    name: "Analytics transport",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description:
      "Anonymous usage transport with a composition-configured collector endpoint.",
    provides: ["analytics"],
    configSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string", minLength: 1 },
        storageKey: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  definition,
}
