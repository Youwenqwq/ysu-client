import {
  Context,
  Inject,
  ScopeStatus,
  type DisposableLike,
  type ForkScope,
  type Plugin,
} from "@cordisjs/core"
import semver from "semver"
import {
  createObservableSource,
  isScopedPluginService,
  PLUGIN_SERVICE_SCOPE,
  type AnyDefinedPlugin,
  type ObservableSource,
  type PluginConfig,
  type PluginManifest,
} from "@orahako/sdk"
import { validatePluginConfig } from "./config"

// @ts-expect-error -- Cordis exports this value at runtime, but its ambient const enum declaration conflicts with isolatedModules.
const CORDIS_SCOPE_FAILED: number = ScopeStatus.FAILED

export type PluginSource = "builtin" | "external"
export type PluginStatus = "registered" | "waiting" | "starting" | "active" | "disabled" | "failed"

export class PluginDependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginDependencyError"
  }
}

export interface PluginState {
  readonly manifest: PluginManifest
  readonly source: PluginSource
  readonly status: PluginStatus
  readonly error?: string
}

export type RuntimePluginExecutable =
  | AnyDefinedPlugin
  | {
      readonly inject?: Inject
      readonly optionalInject?: Inject | readonly string[]
      readonly configSchema?: Record<string, unknown>
      apply(ctx: Context, config: PluginConfig): void | Promise<void>
    }
  | (((ctx: Context, config: PluginConfig) => void | Promise<void>) & {
      readonly inject?: Inject
      readonly optionalInject?: Inject | readonly string[]
      readonly configSchema?: Record<string, unknown>
    })

interface RegisteredPlugin {
  manifest: PluginManifest
  executable: RuntimePluginExecutable
  config: PluginConfig
  source: PluginSource
  cordisPlugin: Plugin.Function<Context, PluginConfig>
  inject: Record<string, Inject.Meta>
  generation: number
  scope?: ForkScope<Context>
  mounted: boolean
  pendingCount: number
  status: PluginStatus
  error?: string
  cleanup: Set<Promise<void>>
  restarting: boolean
  attempt: number
}

interface PluginContextBinding {
  plugin: RegisteredPlugin
  generation: number
  attempt: number
}

/**
 * An in-flight apply that a startup timeout or stop may explicitly abandon.
 * The underlying promise is never treated as settled: the runtime stops
 * awaiting it so `flush`/`dispose` stay bounded, and the task itself ignores
 * late resolution or rejection through the `abandoned` flag.
 */
interface ApplyAbandon {
  readonly plugin: RegisteredPlugin
  readonly generation: number
  readonly signal: Promise<void>
  abandoned: boolean
  abandon(): void
  release(): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  )
}

function invokeExecutable(
  executable: RuntimePluginExecutable,
  ctx: Context,
  config: PluginConfig
): void | Promise<void> {
  if (typeof executable === "function") {
    return executable(ctx, config)
  }
  return (executable.apply as (c: Context, cfg: PluginConfig) => void | Promise<void>)(ctx, config)
}

type CleanupTracker = (promise: PromiseLike<unknown>) => void

function wrapCleanup(dispose: () => unknown, track: CleanupTracker): () => unknown {
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    const result = dispose()
    if (isPromiseLike(result)) track(result)
    return result
  }
}

function wrapDisposableLike(value: DisposableLike, track: CleanupTracker): DisposableLike {
  if (typeof value === "function") {
    return wrapCleanup(value, track)
  }
  if (value !== null && typeof value === "object" && "dispose" in value) {
    const dispose = value.dispose
    if (typeof dispose === "function") {
      // Cordis keeps this exact value in its scope disposables and may hand it
      // back to the plugin, so preserve identity and prototype instead of
      // replacing it with a shallow copy.
      value.dispose = wrapCleanup(dispose.bind(value), track)
    }
  }
  return value
}

/**
 * Shadow `ctx.set` so `provides` is validated against services this plugin
 * actually published. Cleanup callbacks registered through `effect`, `collect`
 * or the `dispose` event are wrapped so the runtime can await their promises;
 * Cordis 3.18 resets scopes without awaiting async disposers.
 */
function trackProvidedServices(
  ctx: Context,
  provided: Set<string>,
  track: CleanupTracker
): Context {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === "set") {
        return (name: string, value: unknown): (() => void) => {
          const dispose = target.set(name, value)
          if (value !== undefined && value !== null) provided.add(name)
          return dispose
        }
      }
      if (property === "effect") {
        return (
          callback: (inner: Context, config: unknown) => DisposableLike,
          config?: unknown
        ) =>
          target.effect(
            (inner: Context, innerConfig: unknown) =>
              wrapDisposableLike(callback(inner, innerConfig), track),
            config
          )
      }
      if (property === "collect") {
        return (label: string, callback: () => DisposableLike) =>
          target.collect(label, () => wrapDisposableLike(callback(), track))
      }
      if (property === "on" || property === "once") {
        const register = Reflect.get(target, property, target) as (
          name: string,
          listener: (...args: unknown[]) => unknown,
          options?: unknown
        ) => unknown
        return (name: string, listener: (...args: unknown[]) => unknown, options?: unknown) => {
          if (name !== "dispose") return register.call(target, name, listener, options)
          return register.call(
            target,
            name,
            (...args: unknown[]) => {
              const result = listener(...args)
              if (isPromiseLike(result)) track(result)
              return result
            },
            options
          )
        }
      }
      return Reflect.get(target, property, receiver)
    },
  })
}

/**
 * Cordis-native plugin runtime.
 *
 * Enabled plugins mount directly into Cordis with `cordisPlugin.inject` so
 * Cordis fibers wait natively for required root services to appear and
 * automatically restart consumers when a root service is replaced.
 */
export class PluginRuntime {
  readonly context = new Context()
  readonly state: ObservableSource<readonly PluginState[]>
  private readonly stateSource = createObservableSource<readonly PluginState[]>([])
  private readonly plugins = new Map<string, RegisteredPlugin>()
  private readonly contexts = new WeakMap<Context, PluginContextBinding>()
  private readonly pendingMounts = new Set<Promise<void>>()
  private readonly pendingCleanupRecycling = new Set<Promise<void>>()
  /** Explicitly abandoned apply promises; never awaited by flush/dispose. */
  private readonly applyAbandons = new Set<ApplyAbandon>()
  private readonly cleanupById = new Map<string, Set<Promise<void>>>()
  /** Registration epoch per cleanup set, so delayed recycling never drops a new owner. */
  private readonly cleanupEpoch = new WeakMap<Set<Promise<void>>, number>()
  private disposed = false
  private disposal?: Promise<void>

  constructor() {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
    void this.context.start()

    this.context.on("internal/error", (error: unknown) => {
      this.syncAllStatuses()
      void error
    })
    const handleScopedError = (source: Context, error: unknown) => {
      const binding = source === this.context ? undefined : this.contexts.get(source)
      if (
        !binding ||
        binding.plugin.generation !== binding.generation ||
        binding.plugin.attempt !== binding.attempt
      ) {
        return
      }
      binding.plugin.status = "failed"
      binding.plugin.error = errorMessage(error)
      this.invalidateDependents(binding.plugin.manifest.id)
      this.publish()
    }
    this.context.on("internal/error", function (this: Context, error: unknown) {
      handleScopedError(this, error)
    })
    this.context.on("internal/status", () => {
      this.syncAllStatuses()
    })
    this.context.on("internal/service", (name: string) => {
      this.restartOptionalConsumers(name)
      this.syncAllStatuses()
    })
    this.context.on("internal/before-service", () => {
      this.syncAllStatuses()
    })
  }

  register(
    pluginOrManifest: AnyDefinedPlugin | PluginManifest,
    definitionOrSource: RuntimePluginExecutable | PluginSource,
    sourceOrConfig?: PluginSource | PluginConfig,
    maybeConfig: PluginConfig = {}
  ): void {
    let manifest: PluginManifest
    let executable: RuntimePluginExecutable
    let source: PluginSource
    let rawConfig: PluginConfig

    if ("manifest" in pluginOrManifest && "apply" in pluginOrManifest) {
      manifest = pluginOrManifest.manifest
      executable = pluginOrManifest
      source = typeof definitionOrSource === "string" ? definitionOrSource : "builtin"
      rawConfig =
        sourceOrConfig && typeof sourceOrConfig === "object" ? sourceOrConfig : maybeConfig
    } else {
      manifest = pluginOrManifest
      executable = definitionOrSource as RuntimePluginExecutable
      source = (sourceOrConfig as PluginSource | undefined) ?? "builtin"
      rawConfig = maybeConfig
    }

    const schema =
      typeof executable === "object" && executable.configSchema !== undefined
        ? executable.configSchema
        : manifest.configSchema
    const resolvedManifest: PluginManifest =
      schema !== undefined && manifest.configSchema === undefined
        ? { ...manifest, configSchema: schema }
        : manifest

    const previous = this.plugins.get(resolvedManifest.id)
    const shouldRemount =
      previous?.status === "active" ||
      previous?.status === "starting" ||
      previous?.status === "waiting"
    if (previous) {
      // Package `requires` ranges are re-evaluated on hot replacement; a newer
      // dependency must not leave already-active dependents on a stale contract.
      this.invalidateDependents(resolvedManifest.id, resolvedManifest.version)
      this.stop(resolvedManifest.id, false)
      this.context.registry.delete(previous.cordisPlugin)
    }

    const definitionInject =
      "inject" in executable && executable.inject !== undefined
        ? Inject.resolve(executable.inject as Inject)
        : {}
    const definitionOptionalInject =
      "optionalInject" in executable && executable.optionalInject !== undefined
        ? Inject.resolve(executable.optionalInject as Inject)
        : {}
    const inject: Record<string, Inject.Meta> = {
      ...Object.fromEntries(
        Object.entries(definitionOptionalInject).map(([name]) => [name, { required: false }])
      ),
      ...definitionInject,
      ...Object.fromEntries(
        (resolvedManifest.inject ?? []).map((name) => [name, { required: true }])
      ),
    }

    const cordisPlugin: Plugin.Function<Context, PluginConfig> = (ctx, resolvedConfig) => {
      const current = this.plugins.get(resolvedManifest.id)
      if (!current || !current.mounted) return
      const generation = current.generation
      // Cordis restarts a consumer on required-service replacement without
      // touching our mount generation; every invocation still owns a distinct
      // attempt so a superseded delayed apply cannot run twice.
      current.attempt += 1
      const attempt = current.attempt
      if (current.status === "failed") {
        // Cordis can revive a scope after a service replacement without
        // incrementing our mount generation; the new apply owns the status.
        current.status = "starting"
        current.error = undefined
      }
      this.scheduleApply(ctx, current, generation, attempt, resolvedConfig)
    }
    cordisPlugin.inject = inject

    const cleanup = this.cleanupById.get(resolvedManifest.id) ?? new Set<Promise<void>>()
    this.cleanupById.set(resolvedManifest.id, cleanup)
    this.cleanupEpoch.set(cleanup, (this.cleanupEpoch.get(cleanup) ?? 0) + 1)
    this.plugins.set(resolvedManifest.id, {
      manifest: resolvedManifest,
      executable,
      config: rawConfig,
      source,
      cordisPlugin,
      inject,
      generation: 0,
      mounted: false,
      pendingCount: 0,
      status: "registered",
      cleanup,
      restarting: false,
      attempt: 0,
    })

    if (shouldRemount) {
      this.start(resolvedManifest.id)
    } else {
      this.publish()
    }
  }

  /**
   * A required-service replacement makes Cordis dispose the old scope and
   * immediately invoke the plugin again. Its async disposers are only tracked
   * after they start, so the new generation must explicitly wait for them
   * before apply runs. Only after that wait is a real apply attempt started.
   */
  private scheduleApply(
    ctx: Context,
    plugin: RegisteredPlugin,
    generation: number,
    attempt: number,
    resolvedConfig: PluginConfig
  ): void {
    if (plugin.generation !== generation || !plugin.mounted || plugin.attempt !== attempt) return
    if (plugin.cleanup.size === 0) {
      this.applyAttempt(ctx, plugin, generation, attempt, resolvedConfig)
      return
    }

    plugin.status = "starting"
    plugin.error = undefined
    plugin.pendingCount += 1
    this.publish()
    const abandon = this.createApplyAbandon(plugin, generation)
    const task = (async () => {
      try {
        await Promise.race([this.waitForCleanup(plugin), abandon.signal])
        if (abandon.abandoned) return
        if (
          plugin.generation !== generation ||
          !plugin.mounted ||
          plugin.attempt !== attempt
        ) {
          return
        }
        this.applyAttempt(ctx, plugin, generation, attempt, resolvedConfig)
      } catch (error) {
        // `applyAttempt` records its own synchronous failures; reaching here
        // means the cleanup wait itself failed.
        if (abandon.abandoned) return
        plugin.status = "failed"
        plugin.error = errorMessage(error)
        this.invalidateDependents(plugin.manifest.id)
        throw error
      } finally {
        abandon.release()
        if (plugin.generation === generation) {
          plugin.pendingCount = Math.max(0, plugin.pendingCount - 1)
        }
        this.publish()
      }
    })()
    ctx.scope.ensure(() => task)
  }

  private applyAttempt(
    ctx: Context,
    current: RegisteredPlugin,
    generation: number,
    attempt: number,
    resolvedConfig: PluginConfig
  ): void {
    if (
      current.generation !== generation ||
      !current.mounted ||
      current.attempt !== attempt
    ) {
      return
    }
    let scoped = ctx
    const scopedServices: Array<{
      name: string
      service: { [PLUGIN_SERVICE_SCOPE](c: Context, m: PluginManifest): unknown }
    }> = []

    for (const [name] of Object.entries(current.inject)) {
      const service: unknown = ctx.get(name)
      if (service == null || !isScopedPluginService(service)) continue
      scoped = scoped.isolate(name)
      scopedServices.push({ name, service })
    }

    const provided = new Set<string>()
    const pluginCtx = trackProvidedServices(scoped, provided, (promise) =>
      this.trackPluginCleanup(current, promise)
    )

    // Facades observe the exact final context passed to apply; service writes
    // themselves stay outside `provides` tracking because they are dependencies.
    for (const { name, service } of scopedServices) {
      scoped.set(name, service[PLUGIN_SERVICE_SCOPE](pluginCtx, current.manifest))
    }

    this.contexts.set(ctx, { plugin: current, generation, attempt })
    this.contexts.set(scoped, { plugin: current, generation, attempt })
    this.contexts.set(pluginCtx, { plugin: current, generation, attempt })

    let result: void | Promise<void>
    try {
      result = invokeExecutable(current.executable, pluginCtx, resolvedConfig)
    } catch (error) {
      current.status = "failed"
      current.error = errorMessage(error)
      this.invalidateDependents(current.manifest.id)
      this.publish()
      throw error
    }

    if (isPromiseLike(result)) {
      current.pendingCount += 1
      current.status = "starting"
      current.error = undefined
      this.publish()
      const abandon = this.createApplyAbandon(current, generation)
      const task = (async () => {
        try {
          await Promise.race([result, abandon.signal])
          if (abandon.abandoned) return
          if (
            current.generation !== generation ||
            current.attempt !== attempt ||
            !current.mounted
          ) {
            return
          }
          this.assertProvides(current, provided)
        } catch (error) {
          if (
            abandon.abandoned ||
            current.generation !== generation ||
            current.attempt !== attempt ||
            !current.mounted
          ) {
            // A service replacement or an explicit abandonment already moved
            // on; do not let the stale rejection cancel the revived scope.
            return
          }
          current.status = "failed"
          current.error = errorMessage(error)
          this.invalidateDependents(current.manifest.id)
          throw error
        } finally {
          abandon.release()
          if (current.generation === generation) {
            current.pendingCount = Math.max(0, current.pendingCount - 1)
          }
          if (current.generation === generation && current.attempt === attempt) {
            this.syncPluginStatus(current)
          }
          this.publish()
        }
      })()
      ctx.scope.ensure(() => task)
    } else {
      try {
        this.assertProvides(current, provided)
      } catch (error) {
        current.status = "failed"
        current.error = errorMessage(error)
        this.invalidateDependents(current.manifest.id)
        this.publish()
        throw error
      }
      current.status = "active"
      current.error = undefined
      this.publish()
    }
  }

  private createApplyAbandon(
    plugin: RegisteredPlugin,
    generation: number
  ): ApplyAbandon {
    const { promise, resolve } = Promise.withResolvers<void>()
    const handle: ApplyAbandon = {
      plugin,
      generation,
      signal: promise,
      abandoned: false,
      abandon() {
        if (this.abandoned) return
        this.abandoned = true
        resolve()
      },
      release: () => {
        this.applyAbandons.delete(handle)
      },
    }
    this.applyAbandons.add(handle)
    return handle
  }

  private abandonApplies(plugin: RegisteredPlugin, generation?: number): void {
    for (const handle of this.applyAbandons) {
      if (handle.plugin !== plugin) continue
      if (generation !== undefined && handle.generation !== generation) continue
      handle.abandon()
    }
  }

  private releaseCleanupBucket(id: string, cleanup: Set<Promise<void>>): void {
    if (this.cleanupById.get(id) !== cleanup) return
    if (cleanup.size === 0) {
      this.cleanupById.delete(id)
      return
    }
    const epoch = this.cleanupEpoch.get(cleanup)
    const pending = Array.from(cleanup)
    const recycling = (async () => {
      await Promise.allSettled(pending)
      // A re-registration bumps the epoch and owns the same cleanup set;
      // leave its pending cleanup registered for the new plugin instance.
      if (this.cleanupById.get(id) === cleanup && this.cleanupEpoch.get(cleanup) === epoch) {
        this.cleanupById.delete(id)
      }
    })()
    this.pendingCleanupRecycling.add(recycling)
    void recycling.then(
      () => this.pendingCleanupRecycling.delete(recycling),
      () => this.pendingCleanupRecycling.delete(recycling)
    )
  }

  unregister(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    this.stop(id)
    this.context.registry.delete(plugin.cordisPlugin)
    this.plugins.delete(id)
    this.releaseCleanupBucket(id, plugin.cleanup)
    this.publish()
  }

  async unregisterAndWait(id: string): Promise<void> {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    this.stop(id)
    await this.waitForCleanup(plugin)
    // A concurrent re-registration owns the id now; never delete it.
    if (this.plugins.get(id) !== plugin) return
    this.context.registry.delete(plugin.cordisPlugin)
    this.plugins.delete(id)
    this.releaseCleanupBucket(id, plugin.cleanup)
    this.publish()
  }

  async stopAndWait(id: string, cascade = true): Promise<void> {
    this.stop(id, cascade)
    const plugin = this.plugins.get(id)
    if (!plugin) return
    await this.waitForCleanup(plugin)
  }

  start(id: string): void {
    if (this.disposed) throw new Error("Plugin runtime has been disposed")
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`Plugin not registered: ${id}`)
    if (
      plugin.mounted &&
      (plugin.status === "active" || plugin.status === "starting" || plugin.status === "waiting")
    ) {
      return
    }

    try {
      for (const [dependency, range] of Object.entries(plugin.manifest.requires ?? {})) {
        const installed = this.plugins.get(dependency)
        if (
          !installed ||
          (installed.status !== "active" &&
            installed.status !== "starting" &&
            installed.status !== "waiting")
        ) {
          throw new PluginDependencyError(`Plugin dependency is not active: ${dependency}`)
        }
        if (!semver.satisfies(installed.manifest.version, range)) {
          throw new PluginDependencyError(
            `Plugin dependency ${dependency}@${installed.manifest.version} does not satisfy ${range}`
          )
        }
      }

      const resolvedConfig = validatePluginConfig(plugin.manifest, plugin.config)
      plugin.generation += 1
      plugin.pendingCount = 0
      plugin.error = undefined
      plugin.mounted = true
      this.mountPlugin(plugin, resolvedConfig)
    } catch (error) {
      this.resetFailedStart(plugin, error)
      this.publish()
      throw error
    }
    this.publish()
  }

  private mountPlugin(plugin: RegisteredPlugin, resolvedConfig: PluginConfig): void {
    const generation = plugin.generation
    const previousScope = plugin.scope
    plugin.scope = undefined
    previousScope?.dispose()
    this.context.registry.delete(plugin.cordisPlugin)

    if (plugin.cleanup.size > 0) {
      // Cordis 3.18 resets scopes without awaiting async disposers. Never let
      // the new generation run native setup before the old one finished
      // releasing it; the sync start/stop API stays available.
      plugin.status = "starting"
      const abandon = this.createApplyAbandon(plugin, generation)
      const mount: Promise<void> = Promise.race([
        this.waitForCleanup(plugin),
        abandon.signal,
      ])
        .then(() => {
          if (abandon.abandoned) return
          if (plugin.generation !== generation || !plugin.mounted) return
          try {
            plugin.scope = this.context.plugin(plugin.cordisPlugin, resolvedConfig)
            this.syncPluginStatus(plugin)
          } catch (error) {
            this.resetFailedStart(plugin, error)
          }
          this.publish()
        })
        .finally(() => {
          abandon.release()
          this.pendingMounts.delete(mount)
        })
      this.pendingMounts.add(mount)
      void mount.catch(() => {})
      return
    }

    plugin.scope = this.context.plugin(plugin.cordisPlugin, resolvedConfig)
    this.syncPluginStatus(plugin)
  }

  private async waitForCleanup(plugin: RegisteredPlugin): Promise<void> {
    while (plugin.cleanup.size > 0) {
      await Promise.allSettled(Array.from(plugin.cleanup))
    }
  }

  private resetFailedStart(plugin: RegisteredPlugin, error: unknown): void {
    plugin.mounted = false
    plugin.pendingCount = 0
    this.abandonApplies(plugin)
    const scope = plugin.scope
    plugin.scope = undefined
    scope?.dispose()
    this.context.registry.delete(plugin.cordisPlugin)
    plugin.status = error instanceof PluginDependencyError ? "registered" : "failed"
    plugin.error = error instanceof PluginDependencyError ? undefined : errorMessage(error)
    this.invalidateDependents(plugin.manifest.id)
  }

  async startAndWait(id: string, timeoutMs = 10_000): Promise<void> {
    this.start(id)
    const initial = this.get(id)
    if (!initial) throw new Error(`Plugin not registered: ${id}`)
    if (initial.status === "active") return
    if (initial.status === "failed") throw new Error(initial.error ?? `Plugin failed: ${id}`)

    const plugin = this.plugins.get(id)!
    const generation = plugin.generation

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    let unsubscribe = () => {}
    let settled = false
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unsubscribe()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => {
      if (settled) return
      if (plugin.generation !== generation || !plugin.mounted) {
        settle(new Error(`Plugin ${id} was stopped during startup`))
        return
      }
      const missing = this.missingInjectedServices(plugin)
      const message =
        missing.length > 0
          ? `Plugin startup timed out waiting for services (${missing.join(", ")}): ${id}`
          : `Plugin startup timed out: ${id}`
      plugin.generation += 1
      plugin.mounted = false
      plugin.pendingCount = 0
      // An apply that never settles cannot be cancelled. Explicitly abandon
      // its tracked task so runtime/host disposal does not wait forever; late
      // resolution and rejection stay ignored by the generation/attempt guards.
      this.abandonApplies(plugin, generation)
      plugin.scope?.dispose()
      this.context.registry.delete(plugin.cordisPlugin)
      plugin.scope = undefined
      plugin.status = "failed"
      plugin.error = message
      this.invalidateDependents(plugin.manifest.id)
      // Unsubscribe before publishing the generation change; otherwise the
      // listener reports a generic stop instead of this timeout.
      settle(new Error(message))
      this.publish()
    }, timeoutMs)

    const check = () => {
      if (settled) return
      const current = this.get(id)
      if (!current || plugin.generation !== generation) {
        settle(new Error(`Plugin ${id} was stopped during startup`))
        return
      }
      if (current.status === "active") {
        settle()
      } else if (current.status === "failed") {
        settle(new Error(current.error ?? `Plugin failed: ${id}`))
      } else if (current.status === "disabled") {
        settle(new Error(`Plugin was disabled during startup: ${id}`))
      }
    }

    unsubscribe = this.subscribe(check)
    check()
    await promise
  }

  async flush(): Promise<void> {
    while (true) {
      await this.context.events.flush()
      const pending = this.pendingWork()
      if (pending.length === 0) break
      await Promise.allSettled(pending)
    }
    this.syncAllStatuses()
  }

  private pendingWork(): Promise<void>[] {
    return [
      ...this.pendingMounts,
      ...this.pendingCleanupRecycling,
      ...Array.from(this.cleanupById.values(), (cleanup) => Array.from(cleanup)).flat(),
    ]
  }

  private trackPluginCleanup(
    plugin: RegisteredPlugin,
    promise: PromiseLike<unknown>
  ): void {
    const tracked: Promise<void> = Promise.resolve(promise).then(
      () => {
        plugin.cleanup.delete(tracked)
      },
      () => {
        plugin.cleanup.delete(tracked)
      }
    )
    plugin.cleanup.add(tracked)
  }

  /**
   * Cordis only restarts consumers for required inject changes. Optional
   * services must remount on appearance, replacement and revocation so the
   * plugin can rebuild its scoped facade and observe the new value.
   */
  private restartOptionalConsumers(name: string): void {
    if (this.disposed) return
    for (const plugin of this.plugins.values()) {
      const dependency = plugin.inject[name]
      if (!dependency || dependency.required) continue
      if (!plugin.mounted || !plugin.scope || plugin.restarting) continue
      if (plugin.manifest.provides?.includes(name)) continue
      plugin.restarting = true
      try {
        plugin.mounted = false
        this.start(plugin.manifest.id)
      } catch {
        // `start` already recorded its own failure; service events must not
        // escape back into Cordis' service setter.
      } finally {
        plugin.restarting = false
      }
    }
  }

  /**
   * Re-checks package `requires` when the dependency changes. `version` is
   * supplied for hot replacements; omitting it invalidates every dependent
   * after the dependency failed to start.
   */
  private invalidateDependents(id: string, version?: string): void {
    for (const dependent of this.plugins.values()) {
      if (dependent.manifest.id === id || !dependent.mounted) continue
      const range = dependent.manifest.requires?.[id]
      if (!range) continue
      if (version !== undefined && semver.satisfies(version, range)) continue
      this.stop(dependent.manifest.id)
    }
  }

  stop(id: string, cascade = true): void {
    const plugin = this.plugins.get(id)
    if (!plugin || (plugin.status === "disabled" && !plugin.scope && !plugin.mounted)) return
    plugin.generation += 1
    plugin.mounted = false
    plugin.pendingCount = 0
    plugin.status = "disabled"
    plugin.error = undefined
    this.abandonApplies(plugin)
    const scope = plugin.scope
    plugin.scope = undefined
    if (cascade) {
      for (const dependent of this.plugins.values()) {
        if (dependent.manifest.id !== id && dependent.manifest.requires?.[id]) {
          this.stop(dependent.manifest.id)
        }
      }
    }
    scope?.dispose()
    this.context.registry.delete(plugin.cordisPlugin)
    this.publish()
  }

  get(id: string): PluginState | undefined {
    const plugin = this.plugins.get(id)
    return plugin ? toState(plugin) : undefined
  }

  getSnapshot(): readonly PluginState[] {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  missingServices(id: string): readonly string[] {
    const plugin = this.plugins.get(id)
    return plugin ? this.missingInjectedServices(plugin) : []
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.disposal = (async () => {
      try {
        // Start every stop synchronously, then await all cleanup so one slow
        // disposer cannot prevent the remaining plugins from being torn down.
        const removals = Array.from(this.plugins.keys(), (id) => this.unregisterAndWait(id))
        await Promise.allSettled(removals)
        await this.flush()
      } finally {
        await this.context.stop()
      }
    })()
    return this.disposal
  }

  private missingInjectedServices(plugin: RegisteredPlugin): string[] {
    return Object.entries(plugin.inject)
      .filter(([, meta]) => meta.required)
      .map(([name]) => name)
      .filter((name) => this.context.get(name) == null)
  }

  private syncAllStatuses(): void {
    let changed = false
    for (const plugin of this.plugins.values()) {
      const before = plugin.status
      const beforeError = plugin.error
      this.syncPluginStatus(plugin)
      if (plugin.status !== before || plugin.error !== beforeError) {
        changed = true
      }
    }
    if (changed) this.publish()
  }

  private syncPluginStatus(plugin: RegisteredPlugin): void {
    if (!plugin.mounted || !plugin.scope) return
    if (plugin.status === "failed") return
    const runtimeScope = plugin.scope.runtime
    if (runtimeScope.uid === null) {
      plugin.status = "disabled"
      return
    }
    // `ScopeStatus` is an ambient const enum in Cordis' typings; its runtime
    // value was resolved above when defining CORDIS_SCOPE_FAILED.
    const rawStatus: number = runtimeScope.status
    if (rawStatus === CORDIS_SCOPE_FAILED) {
      plugin.status = "failed"
      plugin.error = plugin.error ?? errorMessage(runtimeScope.error ?? "Plugin failed")
      return
    }
    if (!runtimeScope.isActive || this.missingInjectedServices(plugin).length > 0) {
      plugin.status = "waiting"
      return
    }
    if (plugin.pendingCount > 0) {
      plugin.status = "starting"
      return
    }
    plugin.status = "active"
  }

  private assertProvides(plugin: RegisteredPlugin, provided: ReadonlySet<string>): void {
    for (const name of plugin.manifest.provides ?? []) {
      if (provided.has(name) && this.context.get(name) != null) continue
      throw new Error(`Plugin ${plugin.manifest.id} did not provide declared service: ${name}`)
    }
  }

  private publish(): void {
    const next = Array.from(this.plugins.values(), toState).sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name)
    )
    this.stateSource.set(next)
  }
}

function toState(plugin: RegisteredPlugin): PluginState {
  return {
    manifest: plugin.manifest,
    source: plugin.source,
    status: plugin.status,
    ...(plugin.error !== undefined ? { error: plugin.error } : {}),
  }
}
