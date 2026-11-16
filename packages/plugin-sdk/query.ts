export interface ProviderQueryPolicy {
  readonly ttl: number
  readonly persist: boolean
}

export interface ProviderQueryIdentity {
  readonly providerId: string
  /** School id plus provider generation; never school protocol fields. */
  readonly providerScope: string
  readonly username: string | null
  readonly feature: string
  readonly params?: unknown
}

export interface PersistentQueryValue<T = unknown> {
  readonly data: T
  readonly updatedAt: number
}

export interface PluginQueryService {
  key(identity: ProviderQueryIdentity): readonly unknown[]
  cacheKey(identity: ProviderQueryIdentity & { username: string }): string
  policy(feature: string): ProviderQueryPolicy
  registerPolicy(feature: string, policy: ProviderQueryPolicy): () => void
  readPersistent<T>(key: string): PersistentQueryValue<T> | null
  writePersistent<T>(key: string, value: PersistentQueryValue<T>): void
  clearPersistent(): void
  invalidate(identity?: Partial<ProviderQueryIdentity>): void
}
