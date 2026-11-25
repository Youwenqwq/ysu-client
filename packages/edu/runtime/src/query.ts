import {
  hasSlice,
  isProviderError,
  ProviderError,
  ProviderErrorCode,
  type AcademicSliceKey,
  type PersistentQueryValue,
  type ProviderQueryIdentity,
  type ProviderQueryPolicy,
  type ProviderRuntimeService,
  type QueryActivitySnapshot,
  type QueryDescriptor,
  type QueryService,
  type QuerySnapshot,
  type QueryStatus,
  type SchoolProvider,
  type SessionService,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type Context,
  type ObservableSource,
  type PluginConfig,
  type PluginManifest,
  type PluginStorageService,
  type ScopedPluginService,
} from "@orahako/sdk"

const PERSISTENT_CACHE_STORAGE_KEY = "persistent-cache-v1"
const HOST_CONSUMER_ID = "orahako.runtime.query"

export const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24
export const LONG_TTL_MS = 1000 * 60 * 60 * 24 * 7
export const SHORT_TTL_MS = 1000 * 60 * 60 * 12
export const SIX_HOUR_TTL_MS = 1000 * 60 * 60 * 6
export const ONE_HOUR_TTL_MS = 1000 * 60 * 60

const DEFAULT_QUERY_POLICY: ProviderQueryPolicy = {
  ttl: DEFAULT_TTL_MS,
  persist: false,
}

export interface QueryRuntimeConfig extends PluginConfig {
  readonly policies?: Record<string, ProviderQueryPolicy>
}

export interface QueryRuntimeServiceOptions {
  readonly ctx: Pick<Context, "emit" | "on">
  readonly provider: ProviderRuntimeService
  readonly session: SessionService
  readonly storage: PluginStorageService
  readonly policies?: Readonly<Record<string, ProviderQueryPolicy>>
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPersistentQueryValue(value: unknown): value is PersistentQueryValue<unknown> {
  if (!isPlainRecord(value)) return false
  return "data" in value && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

function hashKeyPart(part: string): string {
  if (part.length < 80) return part
  let hash = 0
  for (let i = 0; i < part.length; i++) {
    const char = part.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `h${Math.abs(hash).toString(36)}`
}

export function buildCacheKey(parts: readonly string[]): string {
  return parts.map(hashKeyPart).join("|")
}

export function providerQueryKey(
  providerId: string,
  providerScope: string,
  username: string | null,
  feature: string,
  params?: unknown
): readonly unknown[] {
  return ["provider", providerId, providerScope, username ?? null, feature, params ?? null] as const
}

export function providerCacheKey(
  providerId: string,
  providerScope: string,
  username: string,
  feature: string,
  params?: unknown
): string {
  return buildCacheKey([
    "provider",
    providerId,
    providerScope,
    username,
    feature,
    stableStringify(params ?? null),
  ])
}

interface PersistentClearIdentity {
  readonly providerId?: string
  readonly username?: string | null
}

function cacheKeyMatchesIdentity(key: string, identity: PersistentClearIdentity): boolean {
  const segments = key.split("|", 5)
  if (segments[0] !== "provider" || segments.length < 4) return false
  if (identity.providerId !== undefined && segments[1] !== hashKeyPart(identity.providerId)) {
    return false
  }
  if (identity.username !== undefined) {
    if (identity.username === null) return false
    if (segments[3] !== hashKeyPart(identity.username)) return false
  }
  return true
}

function parsePersistentCacheEntries(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isPlainRecord(parsed) && isPlainRecord(parsed.entries)) return parsed.entries
    return isPlainRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function matchesIdentity(
  keyTuple: readonly unknown[],
  identity: Partial<ProviderQueryIdentity> | undefined
): boolean {
  if (keyTuple[0] !== "provider") return false
  if (!identity) return true
  const fields = ["providerId", "providerScope", "username", "feature"] as const
  for (const [index, field] of fields.entries()) {
    if (!(field in identity)) continue
    if (identity[field] !== keyTuple[index + 1]) return false
  }
  if ("params" in identity) {
    return stableStringify(identity.params ?? null) === stableStringify(keyTuple[5] ?? null)
  }
  return true
}

function evaluateEnabled(enabled: boolean | (() => boolean) | undefined): boolean {
  if (enabled === undefined) return true
  return typeof enabled === "function" ? enabled() : enabled
}

function unsupportedSliceError(providerId: string, slice: string): ProviderError {
  return new ProviderError(
    ProviderErrorCode.FEATURE_NOT_SUPPORTED,
    `Provider "${providerId}" does not support slice "${slice}"`,
    undefined,
    501
  )
}

interface PolicyRegistration {
  readonly policy: ProviderQueryPolicy
  active: boolean
}

interface RecordFields {
  status: QueryStatus
  data: unknown
  error: ProviderError | Error | null
  isLoading: boolean
  isRefreshing: boolean
  isStale: boolean
  updatedAt: number | null
}

interface ResolvedIdentity {
  readonly providerId: string
  readonly providerScope: string
  readonly username: string | null
  readonly descriptorKey: string
  readonly paramsKey: string
  readonly sliceKey: string
  readonly recordKey: string
  readonly persistentKey: string | null
  readonly keyTuple: readonly unknown[]
}

class QueryIdentityRecord {
  readonly recordKey: string
  readonly providerId: string
  readonly providerScope: string
  readonly username: string | null
  readonly feature: string
  readonly slice: AcademicSliceKey | undefined
  readonly persistentKey: string | null
  readonly keyTuple: readonly unknown[]

  holderCount = 0
  manualRefreshCount = 0
  fetchEpoch = 0
  inFlight: Promise<unknown> | null = null
  hasMemoryValue = false
  failedFetch = false
  failedSessionExpired = false
  failedCredential: string | null = null
  needsRevalidation = false

  fields: RecordFields = {
    status: "idle",
    data: undefined,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: null,
  }

  private readonly listeners = new Set<() => void>()

  constructor(identity: ResolvedIdentity, feature: string, slice: AcademicSliceKey | undefined) {
    this.recordKey = identity.recordKey
    this.providerId = identity.providerId
    this.providerScope = identity.providerScope
    this.username = identity.username
    this.feature = feature
    this.slice = slice
    this.persistentKey = identity.persistentKey
    this.keyTuple = identity.keyTuple
  }

  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setFields(next: RecordFields): boolean {
    const prev = this.fields
    if (
      prev.status === next.status &&
      Object.is(prev.data, next.data) &&
      Object.is(prev.error, next.error) &&
      prev.isLoading === next.isLoading &&
      prev.isRefreshing === next.isRefreshing &&
      prev.isStale === next.isStale &&
      prev.updatedAt === next.updatedAt
    ) {
      return false
    }
    this.fields = next
    return true
  }

  notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener()
    }
  }
}

interface AnyDescriptor {
  readonly feature: string
  readonly slice?: AcademicSliceKey
  readonly params?: unknown
  readonly enabled?: boolean | (() => boolean)
  readonly releaseOnInactive?: boolean
  fetcher(provider: SchoolProvider): Promise<unknown>
}

class QuerySourceHandle {
  readonly consumerId: string
  readonly descriptorKey: string
  readonly handleKey: string
  readonly source: ObservableSource<QuerySnapshot<unknown>>
  descriptor: AnyDescriptor

  private readonly service: QueryRuntimeService
  private readonly listeners = new Set<() => void>()
  private boundRecord: QueryIdentityRecord
  private detachRecord: (() => void) | null = null
  private cachedSnapshot: QuerySnapshot<unknown>
  private cachedFields: RecordFields
  private lastEvaluatedEnabled: boolean
  private readonly boundRefresh: () => Promise<unknown>

  constructor(
    service: QueryRuntimeService,
    consumerId: string,
    descriptorKey: string,
    descriptor: AnyDescriptor,
    initialRecord: QueryIdentityRecord
  ) {
    this.service = service
    this.consumerId = consumerId
    this.descriptorKey = descriptorKey
    this.handleKey = `${consumerId}|${descriptorKey}`
    this.descriptor = descriptor
    this.boundRecord = initialRecord
    this.lastEvaluatedEnabled = evaluateEnabled(descriptor.enabled)
    this.boundRefresh = () => this.service.refreshHandle(this)
    this.service.syncPassiveRecord(this.boundRecord, this.descriptor)
    this.cachedFields = this.boundRecord.fields
    this.cachedSnapshot = this.buildSnapshot(this.cachedFields)

    this.source = {
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
    }
  }

  get holderCount(): number {
    return this.listeners.size
  }

  get currentRecord(): QueryIdentityRecord {
    return this.boundRecord
  }

  updateDescriptor(next: AnyDescriptor): void {
    const wasEnabled = this.lastEvaluatedEnabled
    this.descriptor = next
    const nowEnabled = evaluateEnabled(next.enabled)
    this.lastEvaluatedEnabled = nowEnabled
    if (this.listeners.size > 0 && wasEnabled !== nowEnabled) {
      this.service.reconcileHandle(this)
    } else if (wasEnabled !== nowEnabled) {
      this.service.syncPassiveRecord(this.boundRecord, this.descriptor)
      this.refreshCachedSnapshot(false)
    }
  }

  rebindRecord(nextRecord: QueryIdentityRecord): void {
    if (this.boundRecord === nextRecord) return
    const active = this.listeners.size > 0
    if (active) {
      this.detachRecord?.()
      this.detachRecord = null
      this.boundRecord.holderCount = Math.max(0, this.boundRecord.holderCount - 1)
    }
    this.boundRecord = nextRecord
    if (active) {
      this.boundRecord.holderCount += 1
      this.detachRecord = this.boundRecord.addListener(() => {
        this.refreshCachedSnapshot(true)
      })
    }
  }

  syncAndNotify(): void {
    this.lastEvaluatedEnabled = evaluateEnabled(this.descriptor.enabled)
    this.refreshCachedSnapshot(true)
  }

  private getSnapshot = (): QuerySnapshot<unknown> => {
    if (this.listeners.size === 0 && this.boundRecord.inFlight === null) {
      const latestRecord = this.service.resolveRecordForDescriptor(this.descriptor, this.boundRecord)
      if (latestRecord !== this.boundRecord) {
        const previousRecord = this.boundRecord
        this.boundRecord = latestRecord
        this.service.releaseRecord(previousRecord)
      }
      this.service.syncPassiveRecord(this.boundRecord, this.descriptor)
    }
    this.refreshCachedSnapshot(false)
    return this.cachedSnapshot
  }

  private subscribe = (listener: () => void): (() => void) => {
    const wasIdle = this.listeners.size === 0
    this.listeners.add(listener)

    if (wasIdle) {
      const previousRecord = this.boundRecord
      const targetRecord = this.service.resolveRecordForDescriptor(this.descriptor)
      this.boundRecord = targetRecord
      if (previousRecord !== targetRecord) this.service.releaseRecord(previousRecord)
      this.boundRecord.holderCount += 1
      this.detachRecord = this.boundRecord.addListener(() => {
        this.refreshCachedSnapshot(true)
      })
      this.service.activateHandle(this)
    }

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.detachRecord?.()
        this.detachRecord = null
        this.boundRecord.holderCount = Math.max(0, this.boundRecord.holderCount - 1)
        this.service.deactivateHandle(this)
      }
    }
  }

  private refreshCachedSnapshot(emitToListeners: boolean): void {
    const nextFields = this.boundRecord.fields
    if (this.cachedFields === nextFields) return
    this.cachedFields = nextFields
    this.cachedSnapshot = this.buildSnapshot(nextFields)
    if (emitToListeners) {
      for (const listener of Array.from(this.listeners)) {
        listener()
      }
    }
  }

  private buildSnapshot(fields: RecordFields): QuerySnapshot<unknown> {
    return {
      status: fields.status,
      data: fields.data,
      error: fields.error,
      isLoading: fields.isLoading,
      isRefreshing: fields.isRefreshing,
      isStale: fields.isStale,
      updatedAt: fields.updatedAt,
      refresh: this.boundRefresh,
    }
  }
}

function sameActivity(left: QueryActivitySnapshot, right: QueryActivitySnapshot): boolean {
  return left.refreshingCount === right.refreshingCount && left.staleCount === right.staleCount
}

export class QueryRuntimeService implements QueryService, ScopedPluginService<QueryService> {
  readonly activity: ObservableSource<QueryActivitySnapshot>
  readonly hydrated: Promise<void>

  private readonly ctx: Pick<Context, "emit" | "on">
  private readonly provider: ProviderRuntimeService
  private readonly session: SessionService
  private readonly storage: PluginStorageService
  private readonly defaults: Readonly<Record<string, ProviderQueryPolicy>>
  private readonly policyRegistrations = new Map<string, PolicyRegistration[]>()

  private readonly memoryCache = new Map<string, PersistentQueryValue<unknown>>()
  private readonly dirtyKeys = new Set<string>()
  private readonly hydrationClearFilters: PersistentClearIdentity[] = []
  private persistenceQueue: Promise<void> = Promise.resolve()
  private clearEpoch = 0
  private hasHydrated = false

  private readonly records = new Map<string, QueryIdentityRecord>()
  private readonly handles = new Map<string, QuerySourceHandle>()
  private readonly latestHandleKeys = new Map<string, string>()
  private readonly activeHandles = new Set<QuerySourceHandle>()
  private activeRefreshCount = 0

  private unsubscribeProvider: (() => void) | null = null
  private unsubscribeSession: (() => void) | null = null
  private unsubscribeInvalidate: (() => void) | null = null
  private lastSessionSnapshot: SessionSnapshot | null = null

  private readonly activitySource = createObservableSource<QueryActivitySnapshot>(
    { refreshingCount: 0, staleCount: 0 },
    sameActivity
  )

  private disposed = false

  constructor({
    ctx,
    provider,
    session,
    storage,
    policies = {},
  }: QueryRuntimeServiceOptions) {
    this.ctx = ctx
    this.provider = provider
    this.session = session
    this.storage = storage
    this.defaults = policies
    this.activity = {
      getSnapshot: this.activitySource.getSnapshot,
      subscribe: this.activitySource.subscribe,
    }
    this.hydrated = this.hydratePersistentCache()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.teardownUpstreamSubscriptions()
    this.activeHandles.clear()
    this.handles.clear()
    this.latestHandleKeys.clear()
    this.records.clear()
    this.activitySource.set({ refreshingCount: 0, staleCount: 0 })
  }

  key = (identity: ProviderQueryIdentity): readonly unknown[] => {
    return providerQueryKey(
      identity.providerId,
      identity.providerScope,
      identity.username,
      identity.feature,
      identity.params
    )
  }

  cacheKey = (identity: ProviderQueryIdentity & { username: string }): string => {
    return providerCacheKey(
      identity.providerId,
      identity.providerScope,
      identity.username,
      identity.feature,
      identity.params
    )
  }

  policy = (feature: string): ProviderQueryPolicy => {
    const stack = this.policyRegistrations.get(feature)
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i]
        if (entry?.active) return entry.policy
      }
    }
    return this.defaults[feature] ?? DEFAULT_QUERY_POLICY
  }

  registerPolicy = (feature: string, policy: ProviderQueryPolicy): (() => void) => {
    if (!feature || !feature.trim()) {
      throw new Error("Query policy feature must not be empty")
    }
    const registration: PolicyRegistration = { policy, active: true }
    let stack = this.policyRegistrations.get(feature)
    if (!stack) {
      stack = []
      this.policyRegistrations.set(feature, stack)
    }
    stack.push(registration)

    let active = true
    return () => {
      if (!active) return
      active = false
      registration.active = false
      const currentStack = this.policyRegistrations.get(feature)
      if (!currentStack) return
      const idx = currentStack.indexOf(registration)
      if (idx >= 0) currentStack.splice(idx, 1)
      if (currentStack.length === 0) {
        this.policyRegistrations.delete(feature)
      }
    }
  }

  readPersistent = <T>(key: string): PersistentQueryValue<T> | null => {
    const entry = this.memoryCache.get(key)
    if (!entry) return null
    return {
      data: entry.data as T,
      updatedAt: entry.updatedAt,
    }
  }

  writePersistent = <T>(key: string, value: PersistentQueryValue<T>): void => {
    const normalized: PersistentQueryValue<unknown> = {
      data: value.data,
      updatedAt: value.updatedAt,
    }
    this.memoryCache.set(key, normalized)
    if (!this.hasHydrated) {
      this.dirtyKeys.add(key)
      return
    }
    this.flushPersistentCache()
  }

  clearPersistent = (identity?: PersistentClearIdentity): void => {
    if (!identity) {
      this.clearEpoch += 1
      this.memoryCache.clear()
      this.dirtyKeys.clear()
      this.hydrationClearFilters.length = 0
      this.enqueuePersistence(async () => {
        try {
          await this.storage.local.removeItem(PERSISTENT_CACHE_STORAGE_KEY)
        } catch {
          // Storage removal errors are non-fatal for in-memory query state.
        }
      })
      return
    }

    const filter: PersistentClearIdentity = { ...identity }
    for (const key of Array.from(this.memoryCache.keys())) {
      if (cacheKeyMatchesIdentity(key, filter)) this.memoryCache.delete(key)
    }
    for (const key of Array.from(this.dirtyKeys)) {
      if (cacheKeyMatchesIdentity(key, filter)) this.dirtyKeys.delete(key)
    }
    if (!this.hasHydrated) this.hydrationClearFilters.push(filter)

    this.enqueuePersistence(async () => {
      try {
        const stored = parsePersistentCacheEntries(
          await this.storage.local.getItem(PERSISTENT_CACHE_STORAGE_KEY)
        )
        if (!stored) return
        let changed = false
        for (const key of Object.keys(stored)) {
          if (!cacheKeyMatchesIdentity(key, filter)) continue
          delete stored[key]
          changed = true
        }
        if (!changed) return
        await this.storage.local.setItem(
          PERSISTENT_CACHE_STORAGE_KEY,
          JSON.stringify({ version: 1, entries: stored })
        )
      } catch {
        // Storage cleanup errors are non-fatal for in-memory query state.
      }
    })
  }

  invalidate = (identity?: Partial<ProviderQueryIdentity>): void => {
    const hadInvalidateListener = this.unsubscribeInvalidate !== null
    if (!hadInvalidateListener) {
      this.applyInvalidation(identity)
    }
    this.ctx.emit("query/invalidate", identity)
  }

  source = <T, K extends AcademicSliceKey = AcademicSliceKey>(
    descriptor: QueryDescriptor<T, K>
  ): ObservableSource<QuerySnapshot<T>> => {
    return this.sourceForConsumer(HOST_CONSUMER_ID, descriptor)
  };

  private sourceForConsumer<T, K extends AcademicSliceKey = AcademicSliceKey>(
    consumerId: string,
    descriptor: QueryDescriptor<T, K>
  ): ObservableSource<QuerySnapshot<T>> {
    const anyDesc: AnyDescriptor = {
      feature: descriptor.feature,
      slice: descriptor.slice,
      params: descriptor.params,
      enabled: descriptor.enabled,
      releaseOnInactive: descriptor.releaseOnInactive,
      fetcher: (provider) => descriptor.fetcher(provider),
    }
    const resolved = this.resolveIdentity(anyDesc)
    const handleKey = `${consumerId}|${resolved.descriptorKey}`
    this.evictStaleState()
    this.pruneConsumerHandles(consumerId, handleKey)
    this.latestHandleKeys.set(consumerId, handleKey)
    const existing = this.handles.get(handleKey)
    if (existing) {
      existing.updateDescriptor(anyDesc)
      return existing.source as ObservableSource<QuerySnapshot<T>>
    }
    const record = anyDesc.releaseOnInactive
      ? new QueryIdentityRecord(resolved, anyDesc.feature, anyDesc.slice)
      : this.getOrCreateRecord(resolved, anyDesc)
    const handle = new QuerySourceHandle(this, consumerId, resolved.descriptorKey, anyDesc, record)
    if (!anyDesc.releaseOnInactive) this.handles.set(handleKey, handle)
    return handle.source as ObservableSource<QuerySnapshot<T>>
  }

  [PLUGIN_SERVICE_SCOPE](consumerCtx: Context, manifest: PluginManifest): QueryService {
    const scopedSources = new WeakMap<
      ObservableSource<QuerySnapshot<unknown>>,
      ObservableSource<QuerySnapshot<unknown>>
    >()

    const wrapScopedSource = <T>(
      rawSource: ObservableSource<QuerySnapshot<T>>
    ): ObservableSource<QuerySnapshot<T>> => {
      const untypedRaw = rawSource as ObservableSource<QuerySnapshot<unknown>>
      const cached = scopedSources.get(untypedRaw)
      if (cached) {
        return cached as ObservableSource<QuerySnapshot<T>>
      }

      const wrapped: ObservableSource<QuerySnapshot<unknown>> = {
        getSnapshot: () => untypedRaw.getSnapshot(),
        subscribe: (listener) => {
          const unsubscribeRaw = untypedRaw.subscribe(listener)
          const offDispose = consumerCtx.on("dispose", () => {
            unsubscribeRaw()
          })
          return () => {
            offDispose()
            unsubscribeRaw()
          }
        },
      }
      scopedSources.set(untypedRaw, wrapped)
      return wrapped as ObservableSource<QuerySnapshot<T>>
    }

    return {
      source: (descriptor) => wrapScopedSource(this.sourceForConsumer(manifest.id, descriptor)),
      activity: this.activity,
      policy: this.policy,
      registerPolicy: (feature, policy) =>
        trackPluginRegistration(consumerCtx, () => this.registerPolicy(feature, policy)),
      invalidate: this.invalidate,
      key: this.key,
      cacheKey: this.cacheKey,
      readPersistent: this.readPersistent,
      writePersistent: this.writePersistent,
      clearPersistent: this.clearPersistent,
    }
  }

  resolveRecordForDescriptor(
    descriptor: AnyDescriptor,
    passiveRecord?: QueryIdentityRecord
  ): QueryIdentityRecord {
    const resolved = this.resolveIdentity(descriptor)
    if (descriptor.releaseOnInactive) {
      if (passiveRecord?.recordKey === resolved.recordKey) return passiveRecord
      return new QueryIdentityRecord(resolved, descriptor.feature, descriptor.slice)
    }
    return this.getOrCreateRecord(resolved, descriptor)
  }

  activateHandle(handle: QuerySourceHandle): void {
    this.activeHandles.add(handle)
    if (handle.descriptor.releaseOnInactive) {
      const existing = this.handles.get(handle.handleKey)
      if (existing && existing !== handle) handle.rebindRecord(existing.currentRecord)
      this.handles.set(handle.handleKey, handle)
      this.records.set(handle.currentRecord.recordKey, handle.currentRecord)
    }
    this.syncUpstreamSubscriptions()
    this.reconcileHandle(handle)
    this.recomputeActivity()
  }

  deactivateHandle(handle: QuerySourceHandle): void {
    this.activeHandles.delete(handle)
    this.syncUpstreamSubscriptions()
    if (handle.descriptor.releaseOnInactive) {
      this.releaseHandle(handle)
    } else if (this.latestHandleKeys.get(handle.consumerId) !== handle.handleKey) {
      // The consumer has since bound a different descriptor (for example new
      // params). Drop its superseded inactive handle instead of retaining it.
      this.releaseHandle(handle)
    }
    this.recomputeActivity()
  }

  private releaseHandle(handle: QuerySourceHandle): void {
    if (this.handles.get(handle.handleKey) === handle) this.handles.delete(handle.handleKey)
    this.releaseRecord(handle.currentRecord)
  }

  /** @internal Drop a record only when no subscriber or manual refresh still uses it. */
  releaseRecord(record: QueryIdentityRecord): void {
    if (record.holderCount !== 0 || record.manualRefreshCount !== 0) return
    if (this.records.get(record.recordKey) === record) this.records.delete(record.recordKey)
    record.fetchEpoch += 1
    record.inFlight = null
  }

  private pruneConsumerHandles(consumerId: string, keepHandleKey: string): void {
    for (const [handleKey, handle] of Array.from(this.handles)) {
      if (handleKey === keepHandleKey) continue
      if (handle.consumerId !== consumerId) continue
      if (handle.holderCount > 0) continue
      this.handles.delete(handleKey)
      this.releaseRecord(handle.currentRecord)
    }
  }

  private evictStaleState(): void {
    for (const [handleKey, handle] of Array.from(this.handles)) {
      if (handle.holderCount > 0) continue
      if (this.isRecordMatchingCurrentEnv(handle.currentRecord)) continue
      this.handles.delete(handleKey)
      this.releaseRecord(handle.currentRecord)
    }
    this.evictUnreferencedRecords()
  }

  private evictUnreferencedRecords(): void {
    const referenced = new Set<QueryIdentityRecord>()
    for (const handle of this.handles.values()) referenced.add(handle.currentRecord)
    for (const handle of this.activeHandles) referenced.add(handle.currentRecord)
    for (const record of Array.from(this.records.values())) {
      if (referenced.has(record)) continue
      this.releaseRecord(record)
    }
  }

  private hasEnabledActiveHandle(record: QueryIdentityRecord): boolean {
    for (const handle of this.activeHandles) {
      if (handle.currentRecord === record && evaluateEnabled(handle.descriptor.enabled)) {
        return true
      }
    }
    return false
  }

  private deactivateRecord(record: QueryIdentityRecord): void {
    if (this.hasEnabledActiveHandle(record)) return
    record.fetchEpoch += 1
    record.inFlight = null
    record.failedFetch = false
    record.failedSessionExpired = false
    record.failedCredential = null
    const changed = record.setFields({
      status: "idle",
      data: undefined,
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      updatedAt: null,
    })
    if (changed) {
      this.recomputeActivity()
      record.notify()
    }
  }

  reconcileHandle(handle: QuerySourceHandle, forceRefresh = false): void {
    if (this.disposed) return
    const previousRecord = handle.currentRecord
    const targetRecord = this.resolveRecordForDescriptor(handle.descriptor, previousRecord)
    if (targetRecord !== previousRecord) {
      handle.rebindRecord(targetRecord)
      this.releaseRecord(previousRecord)
    }
    if (!evaluateEnabled(handle.descriptor.enabled)) {
      this.deactivateRecord(targetRecord)
      handle.syncAndNotify()
      this.recomputeActivity()
      return
    }
    this.reconcileRecord(targetRecord, handle.descriptor, forceRefresh)
    handle.syncAndNotify()
    this.recomputeActivity()
  }

  async refreshHandle(handle: QuerySourceHandle): Promise<unknown> {
    if (this.disposed) return undefined
    if (!evaluateEnabled(handle.descriptor.enabled)) {
      this.deactivateRecord(handle.currentRecord)
      handle.syncAndNotify()
      return undefined
    }

    const previousRecord = handle.currentRecord
    const targetRecord = this.resolveRecordForDescriptor(handle.descriptor, previousRecord)
    if (targetRecord !== previousRecord) {
      handle.rebindRecord(targetRecord)
      this.releaseRecord(previousRecord)
    }
    const providerSnap = this.provider.getSnapshot()
    const activeProvider = providerSnap.provider

    if (
      handle.descriptor.slice &&
      (activeProvider !== null || providerSnap.status === "ready") &&
      !hasSlice(activeProvider, handle.descriptor.slice)
    ) {
      targetRecord.fetchEpoch += 1
      targetRecord.inFlight = null
      targetRecord.hasMemoryValue = false
      const changed = targetRecord.setFields({
        status: "error",
        data: undefined,
        error: unsupportedSliceError(
          activeProvider?.id ?? targetRecord.providerId,
          handle.descriptor.slice
        ),
        isLoading: false,
        isRefreshing: false,
        isStale: false,
        updatedAt: null,
      })
      if (changed) {
        this.recomputeActivity()
        targetRecord.notify()
      }
      handle.syncAndNotify()
      if (handle.descriptor.releaseOnInactive) this.releaseRecord(targetRecord)
      return undefined
    }

    this.seedRecordFromPersistent(targetRecord, handle.descriptor)

    if (providerSnap.status !== "ready" || activeProvider === null) {
      this.reconcileRecord(targetRecord, handle.descriptor)
      handle.syncAndNotify()
      if (handle.descriptor.releaseOnInactive) this.releaseRecord(targetRecord)
      return targetRecord.fields.data
    }

    this.activeRefreshCount += 1
    targetRecord.manualRefreshCount += 1
    this.syncUpstreamSubscriptions()
    try {
      const result = await this.startFetch(targetRecord, handle.descriptor, activeProvider, false)
      handle.syncAndNotify()
      return result
    } finally {
      targetRecord.manualRefreshCount = Math.max(0, targetRecord.manualRefreshCount - 1)
      this.activeRefreshCount = Math.max(0, this.activeRefreshCount - 1)
      if (handle.descriptor.releaseOnInactive) this.releaseRecord(targetRecord)
      this.syncUpstreamSubscriptions()
      this.recomputeActivity()
    }
  }

  syncPassiveRecord(record: QueryIdentityRecord, descriptor: AnyDescriptor): void {
    if (!evaluateEnabled(descriptor.enabled)) {
      if (record.inFlight === null && !this.hasEnabledActiveHandle(record)) {
        record.setFields({
          status: "idle",
          data: undefined,
          error: null,
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          updatedAt: null,
        })
      }
      return
    }

    const providerSnap = this.provider.getSnapshot()
    const activeProvider = providerSnap.provider
    if (
      descriptor.slice &&
      (activeProvider !== null || providerSnap.status === "ready") &&
      !hasSlice(activeProvider, descriptor.slice)
    ) {
      record.setFields({
        status: "error",
        data: undefined,
        error: unsupportedSliceError(activeProvider?.id ?? record.providerId, descriptor.slice),
        isLoading: false,
        isRefreshing: false,
        isStale: false,
        updatedAt: null,
      })
      return
    }

    this.seedRecordFromPersistent(record, descriptor)
  }

  private seedRecordFromPersistent(record: QueryIdentityRecord, descriptor: AnyDescriptor): void {
    if (record.hasMemoryValue || record.inFlight !== null || record.failedFetch) {
      return
    }
    const policy = this.policy(descriptor.feature)
    if (!policy.persist || !record.persistentKey) return
    const cached = this.readPersistent<unknown>(record.persistentKey)
    if (!cached) return

    const isExpired = Date.now() - cached.updatedAt > policy.ttl
    record.hasMemoryValue = true
    record.setFields({
      status: "success",
      data: cached.data,
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: isExpired,
      updatedAt: cached.updatedAt,
    })
  }

  private reconcileRecord(
    record: QueryIdentityRecord,
    descriptor: AnyDescriptor,
    forceRefresh = false
  ): void {
    const providerSnap = this.provider.getSnapshot()
    const activeProvider = providerSnap.provider

    if (
      descriptor.slice &&
      (activeProvider !== null || providerSnap.status === "ready") &&
      !hasSlice(activeProvider, descriptor.slice)
    ) {
      record.fetchEpoch += 1
      record.inFlight = null
      record.hasMemoryValue = false
      record.failedFetch = false
      const changed = record.setFields({
        status: "error",
        data: undefined,
        error: unsupportedSliceError(activeProvider?.id ?? record.providerId, descriptor.slice),
        isLoading: false,
        isRefreshing: false,
        isStale: false,
        updatedAt: null,
      })
      if (changed) {
        this.recomputeActivity()
        record.notify()
      }
      return
    }

    this.seedRecordFromPersistent(record, descriptor)

    if (providerSnap.status !== "ready" || activeProvider === null) {
      if (providerSnap.status === "error" && !record.hasMemoryValue) {
        const changed = record.setFields({
          status: "error",
          data: undefined,
          error: providerSnap.error ?? new Error("Provider initialization failed"),
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          updatedAt: null,
        })
        if (changed) {
          this.recomputeActivity()
          record.notify()
        }
      }
      return
    }

    if (this.hasFailureRecovered(record)) {
      this.clearFailureMarkers(record)
      forceRefresh = true
    }

    const policy = this.policy(descriptor.feature)
    const isExpired =
      record.fields.updatedAt !== null && Date.now() - record.fields.updatedAt > policy.ttl

    if (isExpired && record.hasMemoryValue && !record.fields.isStale) {
      record.setFields({
        ...record.fields,
        isStale: true,
      })
    }

    const shouldFetch =
      forceRefresh ||
      (!record.hasMemoryValue && !record.failedFetch) ||
      record.needsRevalidation ||
      (record.hasMemoryValue && isExpired)

    if (shouldFetch) {
      void this.startFetch(record, descriptor, activeProvider, record.needsRevalidation)
    }
  }

  private startFetch(
    record: QueryIdentityRecord,
    descriptor: AnyDescriptor,
    activeProvider: SchoolProvider,
    forceSupersede: boolean
  ): Promise<unknown> {
    if (record.inFlight !== null && !forceSupersede) {
      return record.inFlight
    }

    record.needsRevalidation = false
    record.failedFetch = false
    const epoch = ++record.fetchEpoch
    const hasExistingData = record.fields.data !== undefined

    const startedChanged = record.setFields(
      hasExistingData
        ? {
            status: "success",
            data: record.fields.data,
            error: null,
            isLoading: false,
            isRefreshing: true,
            isStale: record.fields.isStale,
            updatedAt: record.fields.updatedAt,
          }
        : {
            status: "loading",
            data: undefined,
            error: null,
            isLoading: true,
            isRefreshing: false,
            isStale: false,
            updatedAt: null,
          }
    )

    if (startedChanged) {
      this.recomputeActivity()
      record.notify()
    } else {
      this.recomputeActivity()
    }

    // Invoke the fetcher now, but normalize a synchronous throw into a promise.
    // The await below yields before the catch can clear `inFlight`, so the outer
    // assignment cannot cache an already-settled failure.
    let fetcherResult: Promise<unknown>
    try {
      fetcherResult = Promise.resolve(descriptor.fetcher(activeProvider))
    } catch (error) {
      fetcherResult = Promise.reject(error)
    }
    const pending = (async (): Promise<unknown> => {
      try {
        const result = await fetcherResult
        if (this.disposed || record.fetchEpoch !== epoch) {
          return record.fields.data
        }

        const now = Date.now()
        const currentPolicy = this.policy(descriptor.feature)
        if (currentPolicy.persist && record.persistentKey) {
          this.writePersistent(record.persistentKey, { data: result, updatedAt: now })
        }

        record.inFlight = null
        record.hasMemoryValue = true
        record.failedFetch = false
        record.failedSessionExpired = false
        record.failedCredential = null
        const changed = record.setFields({
          status: "success",
          data: result,
          error: null,
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          updatedAt: now,
        })
        this.recomputeActivity()
        if (changed) {
          record.notify()
        }
        return result
      } catch (err) {
        if (this.disposed || record.fetchEpoch !== epoch) {
          return record.fields.data
        }
        record.inFlight = null
        const failureSession = this.session.getSnapshot()
        record.failedSessionExpired = failureSession.sessionExpired
        record.failedCredential = failureSession.credential

        if (
          isProviderError(err) &&
          err.code === ProviderErrorCode.AUTH_SESSION_EXPIRED &&
          this.isRecordMatchingCurrentEnv(record) &&
          failureSession.isAuthenticated
        ) {
          record.failedSessionExpired = true
          record.failedFetch = true
          this.session.setSessionExpired(true)
        }

        const currentPolicy = this.policy(descriptor.feature)
        if (currentPolicy.persist && record.persistentKey) {
          const fallback = this.readPersistent<unknown>(record.persistentKey)
          if (fallback !== null) {
            record.hasMemoryValue = true
            record.failedFetch = false
            record.failedSessionExpired = false
            record.failedCredential = null
            const changed = record.setFields({
              status: "success",
              data: fallback.data,
              error: null,
              isLoading: false,
              isRefreshing: false,
              isStale: true,
              updatedAt: fallback.updatedAt,
            })
            this.recomputeActivity()
            if (changed) {
              record.notify()
            }
            return fallback.data
          }
        }

        const normalizedError = err instanceof Error ? err : new Error(String(err))
        record.hasMemoryValue = false
        record.failedFetch = true
        const changed = record.setFields({
          status: "error",
          data: undefined,
          error: normalizedError,
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          updatedAt: null,
        })
        this.recomputeActivity()
        if (changed) {
          record.notify()
        }
        return undefined
      }
    })()

    record.inFlight = pending
    return pending
  }

  private applyInvalidation(identity: Partial<ProviderQueryIdentity> | undefined): void {
    if (this.disposed) return
    for (const record of this.records.values()) {
      if (!matchesIdentity(record.keyTuple, identity)) continue
      record.needsRevalidation = true
    }
    for (const handle of Array.from(this.activeHandles)) {
      if (matchesIdentity(handle.currentRecord.keyTuple, identity)) {
        this.reconcileHandle(handle)
      }
    }
  }

  private handleExternalChange = (): void => {
    if (this.disposed) return
    this.reconcileHandles(false)
  }

  private handleSessionChange = (): void => {
    if (this.disposed) return
    const previous = this.lastSessionSnapshot
    const snapshot = this.session.getSnapshot()
    this.lastSessionSnapshot = snapshot
    const recovered = previous !== null && this.hasSessionRecovered(previous, snapshot)
    if (recovered) this.recoverCurrentIdentityRecords()
    this.reconcileHandles(recovered)
  }

  private reconcileHandles(forceRefresh: boolean): void {
    for (const handle of Array.from(this.activeHandles)) {
      this.reconcileHandle(handle, forceRefresh)
    }
    this.evictStaleState()
    this.recomputeActivity()
  }

  private hasSessionRecovered(previous: SessionSnapshot, next: SessionSnapshot): boolean {
    if (next.sessionExpired || !next.isAuthenticated || next.credential === null) return false
    if (previous.sessionExpired) return true
    return previous.credential === null || !previous.isAuthenticated
  }

  private recoverCurrentIdentityRecords(): void {
    for (const record of this.records.values()) {
      if (!this.isRecordMatchingCurrentEnv(record)) continue
      this.clearFailureMarkers(record)
    }
    for (const handle of this.activeHandles) {
      if (!this.isRecordMatchingCurrentEnv(handle.currentRecord)) continue
      this.clearFailureMarkers(handle.currentRecord)
    }
  }

  private clearFailureMarkers(record: QueryIdentityRecord): void {
    record.failedFetch = false
    record.failedSessionExpired = false
    record.failedCredential = null
    record.needsRevalidation = false
  }

  private hasFailureRecovered(record: QueryIdentityRecord): boolean {
    if (!record.failedFetch) return false
    const sessionSnap = this.session.getSnapshot()
    if (sessionSnap.sessionExpired || !sessionSnap.isAuthenticated) return false
    if (sessionSnap.credential === null) return false
    if (record.failedSessionExpired) return true
    return sessionSnap.credential !== record.failedCredential
  }

  private syncUpstreamSubscriptions(): void {
    const shouldObserve =
      !this.disposed && (this.activeHandles.size > 0 || this.activeRefreshCount > 0)

    if (shouldObserve) {
      if (!this.unsubscribeProvider) {
        this.unsubscribeProvider = this.provider.state.subscribe(this.handleExternalChange)
      }
      if (!this.unsubscribeSession) {
        this.lastSessionSnapshot = this.session.getSnapshot()
        this.unsubscribeSession = this.session.state.subscribe(this.handleSessionChange)
      }
      if (!this.unsubscribeInvalidate) {
        this.unsubscribeInvalidate = this.ctx.on("query/invalidate", (identity) => {
          this.applyInvalidation(identity)
        })
      }
    } else {
      this.teardownUpstreamSubscriptions()
    }
  }

  private teardownUpstreamSubscriptions(): void {
    this.unsubscribeProvider?.()
    this.unsubscribeProvider = null
    this.unsubscribeSession?.()
    this.unsubscribeSession = null
    this.lastSessionSnapshot = null
    this.unsubscribeInvalidate?.()
    this.unsubscribeInvalidate = null
  }

  private recomputeActivity(): void {
    if (this.disposed) return
    let refreshingCount = 0
    let staleCount = 0

    const observedRecords = new Set<QueryIdentityRecord>(this.records.values())
    for (const handle of this.activeHandles) observedRecords.add(handle.currentRecord)

    for (const record of observedRecords) {
      if (!this.isRecordMatchingCurrentEnv(record)) continue
      const isObserved = this.hasEnabledActiveHandle(record)
      const isActivelyRefreshing = isObserved || record.manualRefreshCount > 0
      if (isActivelyRefreshing && record.fields.isRefreshing) {
        refreshingCount += 1
      }
      if (isObserved && record.fields.isStale) {
        staleCount += 1
      }
    }

    this.activitySource.set({ refreshingCount, staleCount })
  }

  private isRecordMatchingCurrentEnv(record: QueryIdentityRecord): boolean {
    const providerSnap = this.provider.getSnapshot()
    const sessionSnap = this.session.getSnapshot()
    const currentProviderId = providerSnap.provider?.id ?? providerSnap.schoolId ?? "none"
    const currentScope = `${providerSnap.schoolId ?? "none"}:${providerSnap.generation}`
    const currentUsername = sessionSnap.username ?? null

    return (
      record.providerId === currentProviderId &&
      record.providerScope === currentScope &&
      record.username === currentUsername
    )
  }

  private resolveIdentity(descriptor: AnyDescriptor): ResolvedIdentity {
    const providerSnap = this.provider.getSnapshot()
    const sessionSnap = this.session.getSnapshot()
    const providerId = providerSnap.provider?.id ?? providerSnap.schoolId ?? "none"
    const providerScope = `${providerSnap.schoolId ?? "none"}:${providerSnap.generation}`
    const username = sessionSnap.username ?? null
    const paramsKey = stableStringify(descriptor.params ?? null)
    const sliceKey = descriptor.slice ?? ""
    const descriptorKey = `${descriptor.feature}|${paramsKey}|${sliceKey}${descriptor.releaseOnInactive ? "|transient" : ""}`
    const recordKey = `${providerId}|${providerScope}|${username ?? ""}|${descriptorKey}`
    const persistentKey = username
      ? providerCacheKey(providerId, providerScope, username, descriptor.feature, descriptor.params)
      : null
    const keyTuple = providerQueryKey(
      providerId,
      providerScope,
      username,
      descriptor.feature,
      descriptor.params
    )

    return {
      providerId,
      providerScope,
      username,
      descriptorKey,
      paramsKey,
      sliceKey,
      recordKey,
      persistentKey,
      keyTuple,
    }
  }

  private getOrCreateRecord(
    resolved: ResolvedIdentity,
    descriptor: AnyDescriptor
  ): QueryIdentityRecord {
    const existing = this.records.get(resolved.recordKey)
    if (existing) return existing
    const created = new QueryIdentityRecord(resolved, descriptor.feature, descriptor.slice)
    this.records.set(resolved.recordKey, created)
    return created
  }

  private async hydratePersistentCache(): Promise<void> {
    const epoch = this.clearEpoch
    let raw: string | null = null
    try {
      raw = await this.storage.local.getItem(PERSISTENT_CACHE_STORAGE_KEY)
    } catch {
      raw = null
    }

    if (this.disposed) return

    if (epoch === this.clearEpoch && raw) {
      const entriesRecord = parsePersistentCacheEntries(raw)
      if (entriesRecord) {
        for (const [cacheKey, rawEntry] of Object.entries(entriesRecord)) {
          if (this.dirtyKeys.has(cacheKey)) continue
          if (
            this.hydrationClearFilters.some((filter) => cacheKeyMatchesIdentity(cacheKey, filter))
          ) {
            continue
          }
          if (isPersistentQueryValue(rawEntry)) {
            this.memoryCache.set(cacheKey, {
              data: rawEntry.data,
              updatedAt: rawEntry.updatedAt,
            })
          }
        }
      }
    }

    const hadDirtyWrites = this.dirtyKeys.size > 0
    this.dirtyKeys.clear()
    this.hydrationClearFilters.length = 0
    this.hasHydrated = true

    if (hadDirtyWrites) {
      this.flushPersistentCache()
    }

    for (const handle of Array.from(this.activeHandles)) {
      this.reconcileHandle(handle)
    }
  }

  private enqueuePersistence(task: () => Promise<void>): void {
    this.persistenceQueue = this.persistenceQueue.then(task).catch(() => {})
  }

  private flushPersistentCache(): void {
    this.enqueuePersistence(async () => {
      if (this.disposed) return
      const entries: Record<string, PersistentQueryValue<unknown>> = {}
      for (const [key, value] of this.memoryCache.entries()) {
        entries[key] = value
      }
      const payload = JSON.stringify({ version: 1, entries })
      try {
        await this.storage.local.setItem(PERSISTENT_CACHE_STORAGE_KEY, payload)
      } catch {
        // Storage quota errors must never crash active queries.
      }
    })
  }
}

export const queryRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.query",
    name: "Academic query runtime",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description:
      "React-free observable query sources, TTL policies, persistent cache, and activity counts.",
    inject: ["provider", "session", "storage"],
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
  inject: ["provider", "session", "storage"],
  apply(ctx, config: QueryRuntimeConfig = {}) {
    const service = new QueryRuntimeService({
      ctx,
      provider: ctx.provider,
      session: ctx.session,
      storage: ctx.storage,
      policies: config.policies,
    })
    ctx.set("query", service)
    ctx.effect(() => () => service.dispose())
  },
})
