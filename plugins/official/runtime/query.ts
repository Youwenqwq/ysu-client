import type { Context } from "@cordisjs/core"
import { mutate } from "swr"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type CompositionPlugin,
  type PersistentQueryValue,
  type PluginQueryService,
  type ProviderQueryIdentity,
  type ProviderQueryPolicy,
  type ScopedPluginService,
  trackPluginRegistration,
} from "@orahako/plugin-sdk"
import {
  cacheGetStale,
  cacheKey,
  cacheSet,
  clearAllCache,
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
} from "./query/cache"

const SHORT_TTL_MS = 1000 * 60 * 60 * 12
const SIX_HOUR_TTL_MS = 1000 * 60 * 60 * 6
const ONE_HOUR_TTL_MS = 1000 * 60 * 60

/** Default feature policies used by the official composition. */
export const officialQueryPolicies: Readonly<Record<string, ProviderQueryPolicy>> = {
  "student-info": { ttl: LONG_TTL_MS, persist: true },
  schedule: { ttl: LONG_TTL_MS, persist: true },
  "class-periods": { ttl: LONG_TTL_MS, persist: true },
  "term-calendar": { ttl: LONG_TTL_MS, persist: true },
  "training-plan": { ttl: LONG_TTL_MS, persist: true },
  "current-week": { ttl: SHORT_TTL_MS, persist: true },
  grades: { ttl: DEFAULT_TTL_MS, persist: true },
  "gpa-stats": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-statistics": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-distribution": { ttl: DEFAULT_TTL_MS, persist: true },
  "grade-ranking": { ttl: DEFAULT_TTL_MS, persist: true },
  exams: { ttl: DEFAULT_TTL_MS, persist: true },
  "academic-completion": { ttl: DEFAULT_TTL_MS, persist: true },
  "academic-warnings": { ttl: DEFAULT_TTL_MS, persist: true },
  "labor-records": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "labor-summary": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "labor-activities": { ttl: ONE_HOUR_TTL_MS, persist: true },
  "credit-batches": { ttl: DEFAULT_TTL_MS, persist: true },
  "credit-declarations": { ttl: ONE_HOUR_TTL_MS, persist: true },
  "credit-records": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "credit-summary": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "credit-competitions": { ttl: DEFAULT_TTL_MS, persist: true },
  "credit-library-activities": { ttl: DEFAULT_TTL_MS, persist: true },
  "comprehensive-terms": { ttl: DEFAULT_TTL_MS, persist: true },
  "comprehensive-result": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "comprehensive-indicators": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "comprehensive-radar": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "comprehensive-year-scores": { ttl: SIX_HOUR_TTL_MS, persist: true },
  "comprehensive-report-years": { ttl: DEFAULT_TTL_MS, persist: true },
  "comprehensive-report": { ttl: SIX_HOUR_TTL_MS, persist: true },
}

const DEFAULT_QUERY_POLICY: ProviderQueryPolicy = { ttl: DEFAULT_TTL_MS, persist: false }

export interface QueryRuntimeConfig {
  /** Replaces the official policy map wholesale. */
  policies?: Record<string, ProviderQueryPolicy>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
    .join(",")}}`
}

/** Builds the SWR key shared by every provider query. */
export function providerQueryKey(
  providerId: string,
  providerScope: string,
  username: string | null,
  feature: string,
  params?: unknown
): readonly unknown[] {
  return [
    "provider",
    providerId,
    providerScope,
    username ?? null,
    feature,
    params ?? null,
  ] as const
}

/** Builds the persistent cache key for a provider query with an account. */
export function providerCacheKey(
  providerId: string,
  providerScope: string,
  username: string,
  feature: string,
  params?: unknown
): string {
  return cacheKey([
    "provider",
    providerId,
    providerScope,
    username,
    feature,
    stableStringify(params ?? null),
  ])
}

function matchesIdentity(
  key: readonly unknown[],
  identity: Partial<ProviderQueryIdentity> | undefined
): boolean {
  if (key[0] !== "provider" || !identity) return key[0] === "provider"
  const fields = ["providerId", "providerScope", "username", "feature"] as const
  for (const [index, field] of fields.entries()) {
    if (!(field in identity)) continue
    if (identity[field] !== key[index + 1]) return false
  }
  if ("params" in identity) {
    return stableStringify(identity.params ?? null) === stableStringify(key[5])
  }
  return true
}

function isPersistentQueryValue<T>(value: unknown): value is PersistentQueryValue<T> {
  if (typeof value !== "object" || value === null) return false
  return "data" in value && "updatedAt" in value && typeof value.updatedAt === "number"
}

interface PolicyRegistration {
  policy: ProviderQueryPolicy
  active: boolean
}

export class QueryRuntimeService implements ScopedPluginService<PluginQueryService> {
  private readonly registrations = new Map<string, PolicyRegistration[]>()

  constructor(
    private readonly ctx: Context,
    private readonly defaults: Readonly<Record<string, ProviderQueryPolicy>> = officialQueryPolicies
  ) {}

  key = (identity: ProviderQueryIdentity): readonly unknown[] =>
    providerQueryKey(
      identity.providerId,
      identity.providerScope,
      identity.username,
      identity.feature,
      identity.params
    )

  cacheKey = (identity: ProviderQueryIdentity & { username: string }): string =>
    providerCacheKey(
      identity.providerId,
      identity.providerScope,
      identity.username,
      identity.feature,
      identity.params
    )

  policy = (feature: string): ProviderQueryPolicy => {
    const stack = this.registrations.get(feature)
    if (stack) {
      for (let index = stack.length - 1; index >= 0; index--) {
        if (stack[index].active) return stack[index].policy
      }
    }
    return this.defaults[feature] ?? DEFAULT_QUERY_POLICY
  }

  registerPolicy = (feature: string, policy: ProviderQueryPolicy): (() => void) => {
    if (!feature) throw new Error("Query policy feature must not be empty")
    const registration: PolicyRegistration = { policy, active: true }
    const stack = this.registrations.get(feature) ?? []
    if (!this.registrations.has(feature)) this.registrations.set(feature, stack)
    stack.push(registration)

    let active = true
    return () => {
      if (!active) return
      active = false
      registration.active = false
      const index = stack.indexOf(registration)
      if (index >= 0) stack.splice(index, 1)
      if (stack.length === 0) this.registrations.delete(feature)
    }
  }

  readPersistent = <T>(key: string): PersistentQueryValue<T> | null => {
    const cached = cacheGetStale<PersistentQueryValue<T> | T>(key, 0)
    if (!cached) return null
    const value = cached.data
    if (isPersistentQueryValue<T>(value)) return value
    // Cache entries written before the query runtime owned persistence stored
    // the value directly; keep them readable while marking their age unknown.
    return { data: value, updatedAt: 0 }
  }

  writePersistent = <T>(key: string, value: PersistentQueryValue<T>): void => {
    cacheSet(key, value)
  }

  clearPersistent = (): void => {
    clearAllCache()
  }

  invalidate = (identity?: Partial<ProviderQueryIdentity>): void => {
    // SWR keys outside the provider family must never be revalidated here.
    void mutate((key) =>
      Array.isArray(key) ? matchesIdentity(key, identity) : false
    ).catch(() => undefined)
    this.ctx.emit("query/invalidate", identity)
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context): PluginQueryService {
    return {
      key: this.key,
      cacheKey: this.cacheKey,
      policy: this.policy,
      registerPolicy: (feature, policy) =>
        trackPluginRegistration(ctx, () => this.registerPolicy(feature, policy)),
      readPersistent: this.readPersistent,
      writePersistent: this.writePersistent,
      clearPersistent: this.clearPersistent,
      invalidate: this.invalidate,
    }
  }
}

export const queryRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.query",
    name: "Provider query cache",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "Provider query keys, feature policies, persistent cache and invalidation",
    provides: ["query"],
    configSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        policies: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: false,
            required: ["ttl", "persist"],
            properties: {
              ttl: { type: "number", minimum: 0 },
              persist: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  definition: definePlugin((ctx, config: QueryRuntimeConfig = {}) => {
    ctx.set("query", new QueryRuntimeService(ctx, config.policies ?? officialQueryPolicies))
  }),
}
