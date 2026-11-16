import type { Context } from "@cordisjs/core"
import type {
  ManagedProvider,
  PluginProviderRuntimeService,
  PluginSessionService,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
} from "@orahako/plugin-sdk"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"

/** Read side of the provider contribution registry used by the runtime. */
export interface ProviderCatalog {
  hasProvider(schoolId: string): boolean
  createProvider(schoolId: string): ManagedProvider
  subscribe(listener: (schoolId: string) => void): () => void
}

export interface ProviderRuntimeOptions {
  /** Scope that publishes `provider/changed` and `provider/ready`. */
  ctx: Context
  registry: ProviderCatalog
  session: PluginSessionService
  /** School selected when the session has not activated one. */
  defaultSchoolId?: string
}

interface PendingInitialization {
  readonly generation: number
  readonly promise: Promise<ManagedProvider>
}

function unsupportedSchool(schoolId: string): ProviderError {
  return new ProviderError(
    ProviderErrorCode.FEATURE_NOT_SUPPORTED,
    `Unsupported school provider: ${schoolId}`,
    undefined,
    501
  )
}

/**
 * Owns the current provider instance and its lifecycle.
 *
 * Selection is explicit: the runtime resolves the session's active school (or
 * the configured default) once, and never falls back to another school when
 * that selection cannot be served. Every asynchronous operation captures the
 * active generation, so replacing, resetting or revoking a factory can no
 * longer let a stale initialization publish state for the previous provider.
 */
export class ProviderRuntime implements PluginProviderRuntimeService {
  private readonly ctx: Context
  private readonly registry: ProviderCatalog
  private readonly session: PluginSessionService
  private readonly defaultSchoolId: string | undefined
  private readonly listeners = new Set<() => void>()
  private readonly detachRegistry: () => void
  private snapshot: ProviderRuntimeSnapshot = {
    status: "unavailable",
    schoolId: null,
    provider: null,
    error: null,
    generation: 0,
  }
  private provider: ManagedProvider | null = null
  private schoolId: string | null = null
  private generation = 0
  private authOperation = 0
  private pending: PendingInitialization | null = null
  private disposed = false

  constructor({ ctx, registry, session, defaultSchoolId }: ProviderRuntimeOptions) {
    this.ctx = ctx
    this.registry = registry
    this.session = session
    this.defaultSchoolId = defaultSchoolId
    this.detachRegistry = registry.subscribe((schoolId) => this.handleRegistrationChange(schoolId))
  }

  /** Detaches registry observation; the owning plugin calls this on dispose. */
  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.detachRegistry()
    this.pending = null
    if (this.provider) this.retire(this.provider)
    this.provider = null
    this.listeners.clear()
  }

  getSnapshot = (): ProviderRuntimeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getActive = (): ManagedProvider => {
    if (this.provider) return this.provider
    return this.activatePreferred()
  }

  selectSchool = (schoolId: string): ManagedProvider => {
    if (!schoolId) {
      this.markUnavailable(null)
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        "A provider school id is required",
        undefined,
        501
      )
    }
    if (!this.registry.hasProvider(schoolId)) {
      this.markUnavailable(schoolId)
      throw unsupportedSchool(schoolId)
    }
    if (this.provider && this.schoolId === schoolId) {
      if (this.session.getSnapshot().activeSchoolId !== schoolId) {
        this.session.activateSchool(schoolId)
      }
      return this.provider
    }
    return this.activate(schoolId)
  }

  initialize = async (): Promise<ManagedProvider> => {
    let provider = this.provider
    if (!provider) provider = this.activatePreferred()
    if (this.snapshot.status === "ready" && this.snapshot.provider === provider) return provider

    const generation = this.generation
    if (this.pending?.generation === generation) return this.pending.promise
    if (this.snapshot.status !== "initializing" || this.snapshot.provider !== provider) {
      this.update({ status: "initializing", schoolId: this.schoolId, provider, error: null })
    }
    return this.startInitialization(provider, generation)
  }

  reset = async (): Promise<void> => {
    const provider = this.provider
    if (!provider) return
    const generation = ++this.generation
    this.authOperation += 1
    this.pending = null
    try {
      await provider.reset()
    } finally {
      if (this.generation === generation) {
        this.update({ status: "initializing", error: null })
      }
    }
  }

  logout = async (): Promise<void> => {
    this.authOperation += 1
    this.pending = null
    const provider = this.provider
    if (!provider) return
    const generation = ++this.generation
    try {
      await provider.logout()
    } finally {
      if (this.generation === generation) {
        this.update({ status: "initializing", error: null })
      }
    }
  }

  relogin = async (): Promise<boolean> => {
    const provider = this.provider
    if (!provider) return false
    const generation = this.generation
    const operation = this.authOperation
    const success = await provider.relogin()
    if (!success || operation !== this.authOperation || generation !== this.generation) {
      return false
    }
    if (this.provider !== provider) return false
    this.session.setSessionExpired(false)
    if (this.snapshot.error) this.update({ error: null })
    return true
  }

  private activate(schoolId: string): ManagedProvider {
    if (this.provider && this.schoolId !== schoolId) this.retire(this.provider)
    const provider = this.registry.createProvider(schoolId)
    this.provider = provider
    this.schoolId = schoolId
    this.generation += 1
    this.authOperation += 1
    this.pending = null
    this.update({ status: "initializing", schoolId, provider, error: null })
    if (this.session.getSnapshot().activeSchoolId !== schoolId) {
      this.session.activateSchool(schoolId)
    }
    return provider
  }

  private activatePreferred(): ManagedProvider {
    const sessionSchoolId = this.session.getSnapshot().activeSchoolId
    const schoolId = sessionSchoolId ?? this.defaultSchoolId ?? null
    if (schoolId && this.registry.hasProvider(schoolId)) return this.activate(schoolId)
    if (this.provider) this.retire(this.provider)
    this.markUnavailable(schoolId)
    throw schoolId
      ? unsupportedSchool(schoolId)
      : new ProviderError(
          ProviderErrorCode.FEATURE_NOT_SUPPORTED,
          "No school provider is selected",
          undefined,
          501
        )
  }

  private startInitialization(
    provider: ManagedProvider,
    generation: number
  ): Promise<ManagedProvider> {
    const guarded = (async () => {
      await provider.initialize()
      if (this.generation !== generation || this.provider !== provider) {
        throw new ProviderError(
          ProviderErrorCode.UNKNOWN,
          "Provider initialization was superseded by a newer selection",
          undefined,
          409
        )
      }
      this.pending = null
      this.update({ status: "ready", error: null })
      this.ctx.emit("provider/ready", this.snapshot)
      return provider
    })().catch((cause: unknown) => {
      if (this.generation === generation && this.provider === provider) {
        this.pending = null
        this.update({
          status: "error",
          error: cause instanceof Error ? cause : new Error(String(cause)),
        })
      }
      throw cause
    })
    this.pending = { generation, promise: guarded }
    return guarded
  }

  /**
   * A replaced or revoked factory invalidates the cached instance. When the
   * school becomes unregistered the snapshot turns unavailable instead of
   * silently keeping the previous provider.
   */
  private handleRegistrationChange(schoolId: string): void {
    if (schoolId !== this.schoolId) return
    if (this.provider) this.retire(this.provider)
    this.provider = null
    this.pending = null
    this.authOperation += 1
    this.generation += 1
    const status: ProviderRuntimeStatus = this.registry.hasProvider(schoolId)
      ? "initializing"
      : "unavailable"
    this.update({ status, schoolId, provider: null, error: null })
  }

  private retire(provider: ManagedProvider): void {
    void provider.reset().catch((error) => {
      this.ctx.emit("internal/warning", `Provider reset failed: ${String(error)}`)
    })
  }

  private markUnavailable(schoolId: string | null): void {
    const changed =
      this.provider !== null ||
      this.schoolId !== schoolId ||
      this.snapshot.status !== "unavailable" ||
      this.snapshot.error !== null
    this.provider = null
    this.schoolId = schoolId
    this.pending = null
    this.authOperation += 1
    if (!changed) return
    this.generation += 1
    this.update({ status: "unavailable", schoolId, provider: null, error: null })
  }

  private update(patch: Partial<Omit<ProviderRuntimeSnapshot, "generation">>): void {
    this.snapshot = { ...this.snapshot, ...patch, generation: this.generation }
    for (const listener of this.listeners) listener()
    this.ctx.emit("provider/changed", this.snapshot)
  }
}
