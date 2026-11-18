import {
  ProviderError,
  ProviderErrorCode,
  type ProviderRegistryService,
  type ProviderRuntimeService,
  type ProviderRuntimeSnapshot,
  type ProviderRuntimeStatus,
  type SchoolProvider,
  type SessionService,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type Context,
  type ObservableSource,
  type PluginConfig,
} from "@orahako/sdk"

export type ProviderCatalog = Pick<
  ProviderRegistryService,
  "hasProvider" | "createProvider" | "subscribe"
>

export interface ProviderRuntimeConfig extends PluginConfig {
  readonly defaultSchoolId?: string
}

export interface ProviderRuntimeOptions {
  readonly ctx: Pick<Context, "emit">
  readonly registry: ProviderCatalog
  readonly session: SessionService
  readonly defaultSchoolId?: string
}

interface PendingInitialization {
  readonly generation: number
  readonly promise: Promise<SchoolProvider>
}

function unsupportedSchool(schoolId: string): ProviderError {
  return new ProviderError(
    ProviderErrorCode.FEATURE_NOT_SUPPORTED,
    `Unsupported school provider: ${schoolId}`,
    undefined,
    501
  )
}

export class ProviderRuntime implements ProviderRuntimeService {
  readonly state: ObservableSource<ProviderRuntimeSnapshot>

  private readonly ctx: Pick<Context, "emit">
  private readonly registry: ProviderCatalog
  private readonly session: SessionService
  private readonly defaultSchoolId: string | undefined
  private readonly detachRegistry: () => void
  private readonly stateSource: ReturnType<typeof createObservableSource<ProviderRuntimeSnapshot>>

  private provider: SchoolProvider | null = null
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
    this.stateSource = createObservableSource<ProviderRuntimeSnapshot>({
      status: "unavailable",
      schoolId: null,
      provider: null,
      error: null,
      generation: 0,
    })
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
    this.detachRegistry = registry.subscribe((schoolId) => this.handleRegistrationChange(schoolId))
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.detachRegistry()
    this.pending = null
    if (this.provider) {
      this.retire(this.provider)
    }
    this.provider = null
  }

  getSnapshot = (): ProviderRuntimeSnapshot => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  getActive = (): SchoolProvider => {
    if (this.provider) return this.provider
    return this.activatePreferred()
  }

  selectSchool = (schoolId: string): SchoolProvider => {
    if (!schoolId || !schoolId.trim()) {
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

  initialize = (): Promise<SchoolProvider> => {
    let provider = this.provider
    if (!provider) {
      try {
        provider = this.activatePreferred()
      } catch (error) {
        return Promise.reject(error)
      }
    }
    const currentSnapshot = this.stateSource.getSnapshot()
    if (currentSnapshot.status === "ready" && currentSnapshot.provider === provider) {
      return Promise.resolve(provider)
    }

    const generation = this.generation
    if (this.pending?.generation === generation) {
      return this.pending.promise
    }
    if (currentSnapshot.status !== "initializing" || currentSnapshot.provider !== provider) {
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
      if (!this.disposed && this.generation === generation) {
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
      if (!this.disposed && this.generation === generation) {
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
    if (
      this.disposed ||
      !success ||
      operation !== this.authOperation ||
      generation !== this.generation ||
      this.provider !== provider
    ) {
      return false
    }
    this.session.setSessionExpired(false)
    if (this.stateSource.getSnapshot().error !== null) {
      this.update({ error: null })
    }
    return true
  }

  private activate(schoolId: string): SchoolProvider {
    if (this.provider && this.schoolId !== schoolId) {
      this.retire(this.provider)
    }
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

  private activatePreferred(): SchoolProvider {
    const sessionSchoolId = this.session.getSnapshot().activeSchoolId
    const schoolId = sessionSchoolId ?? this.defaultSchoolId ?? null
    if (schoolId && this.registry.hasProvider(schoolId)) {
      return this.activate(schoolId)
    }
    if (this.provider) {
      this.retire(this.provider)
    }
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
    provider: SchoolProvider,
    generation: number
  ): Promise<SchoolProvider> {
    const guarded = (async () => {
      await provider.initialize()
      if (this.disposed || this.generation !== generation || this.provider !== provider) {
        throw new ProviderError(
          ProviderErrorCode.UNKNOWN,
          "Provider initialization was superseded by a newer selection",
          undefined,
          409
        )
      }
      this.pending = null
      this.update({ status: "ready", error: null })
      this.ctx.emit("provider/ready", this.stateSource.getSnapshot())
      return provider
    })().catch((cause: unknown) => {
      if (!this.disposed && this.generation === generation && this.provider === provider) {
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

  private handleRegistrationChange(schoolId: string): void {
    if (this.disposed || schoolId !== this.schoolId) return
    if (this.provider) {
      this.retire(this.provider)
    }
    this.provider = null
    this.pending = null
    this.authOperation += 1
    this.generation += 1

    if (!this.registry.hasProvider(schoolId)) {
      const status: ProviderRuntimeStatus = "unavailable"
      this.update({ status, schoolId, provider: null, error: null })
      return
    }

    try {
      const nextProvider = this.registry.createProvider(schoolId)
      this.provider = nextProvider
      this.update({ status: "initializing", schoolId, provider: nextProvider, error: null })
    } catch (cause) {
      this.update({
        status: "error",
        schoolId,
        provider: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      })
    }
  }

  private retire(provider: SchoolProvider): void {
    void provider.reset().catch((error) => {
      this.ctx.emit("internal/warning", `Provider reset failed: ${String(error)}`)
    })
  }

  private markUnavailable(schoolId: string | null): void {
    const currentSnapshot = this.stateSource.getSnapshot()
    const changed =
      this.provider !== null ||
      this.schoolId !== schoolId ||
      currentSnapshot.status !== "unavailable" ||
      currentSnapshot.error !== null

    this.provider = null
    this.schoolId = schoolId
    this.pending = null
    this.authOperation += 1
    if (!changed) return
    this.generation += 1
    this.update({ status: "unavailable", schoolId, provider: null, error: null })
  }

  private update(patch: Partial<Omit<ProviderRuntimeSnapshot, "generation">>): void {
    if (this.disposed) return
    const next: ProviderRuntimeSnapshot = {
      ...this.stateSource.getSnapshot(),
      ...patch,
      generation: this.generation,
    }
    this.stateSource.set(next)
    this.ctx.emit("provider/changed", next)
  }
}

export const providerRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.provider",
    name: "Provider lifecycle runtime",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "Selected school provider, generation-safe initialization, and auth transitions.",
    inject: ["providers", "session"],
    provides: ["provider"],
    configSchema: {
      type: "object",
      properties: {
        defaultSchoolId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  inject: ["providers", "session"],
  apply(ctx, config: ProviderRuntimeConfig = {}) {
    const runtime = new ProviderRuntime({
      ctx,
      registry: ctx.providers,
      session: ctx.session,
      defaultSchoolId: config.defaultSchoolId,
    })
    ctx.set("provider", runtime)
    ctx.effect(() => () => runtime.dispose())
  },
})
