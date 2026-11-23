import { Context, Inject, type ForkScope, type Plugin } from "@cordisjs/core"
import semver from "semver"

/** Numeric value of Cordis `ScopeStatus.FAILED` (ambient const enum). */
const CORDIS_SCOPE_FAILED = 3
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
      readonly configSchema?: Record<string, unknown>
      apply(ctx: Context, config: PluginConfig): void | Promise<void>
    }
  | (((ctx: Context, config: PluginConfig) => void | Promise<void>) & {
      readonly inject?: Inject
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
}

interface PluginContextBinding {
  plugin: RegisteredPlugin
  generation: number
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

/**
 * Shadow `ctx.set` so `provides` is validated against services this plugin
 * actually published, not a root service that already happened to exist.
 * The tracking context delegates every other member to the scoped context.
 */
function trackProvidedServices(ctx: Context, provided: Set<string>): Context {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      if (property === "set") {
        return (name: string, value: unknown): (() => void) => {
          const dispose = target.set(name, value)
          if (value !== undefined && value !== null) provided.add(name)
          return dispose
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
      if (!binding || binding.plugin.generation !== binding.generation) return
      binding.plugin.status = "failed"
      binding.plugin.error = errorMessage(error)
      this.publish()
    }
    this.context.on("internal/error", function (this: Context, error: unknown) {
      handleScopedError(this, error)
    })
    this.context.on("internal/status", () => {
      this.syncAllStatuses()
    })
    this.context.on("internal/service", () => {
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
      this.stop(resolvedManifest.id, false)
      this.context.registry.delete(previous.cordisPlugin)
    }

    const definitionInject =
      "inject" in executable && executable.inject !== undefined
        ? Inject.resolve(executable.inject as Inject)
        : {}
    const inject: Record<string, Inject.Meta> = {
      ...definitionInject,
      ...Object.fromEntries(
        (resolvedManifest.inject ?? []).map((name) => [name, { required: true }])
      ),
    }

    const cordisPlugin: Plugin.Function<Context, PluginConfig> = (ctx, resolvedConfig) => {
      const current = this.plugins.get(resolvedManifest.id)
      if (!current || !current.mounted) return
      const generation = current.generation
      let scoped = ctx
      const scopedServices: Array<{
        name: string
        service: { [PLUGIN_SERVICE_SCOPE](c: Context, m: PluginManifest): unknown }
      }> = []

      for (const [name, dependency] of Object.entries(current.inject)) {
        if (!dependency.required) continue
        const service: unknown = ctx.get(name)
        if (isScopedPluginService(service)) {
          scoped = scoped.isolate(name)
          scopedServices.push({ name, service })
        }
      }

      const provided = new Set<string>()
      const pluginCtx = trackProvidedServices(scoped, provided)

      // Facades observe the exact final context passed to apply; service writes
      // themselves stay outside `provides` tracking because they are dependencies.
      for (const { name, service } of scopedServices) {
        scoped.set(name, service[PLUGIN_SERVICE_SCOPE](pluginCtx, current.manifest))
      }

      this.contexts.set(ctx, { plugin: current, generation })
      this.contexts.set(scoped, { plugin: current, generation })
      this.contexts.set(pluginCtx, { plugin: current, generation })

      let result: void | Promise<void>
      try {
        result = invokeExecutable(current.executable, pluginCtx, resolvedConfig)
      } catch (error) {
        current.status = "failed"
        current.error = errorMessage(error)
        this.publish()
        throw error
      }

      if (isPromiseLike(result)) {
        current.pendingCount += 1
        current.status = "starting"
        current.error = undefined
        this.publish()
        ctx.scope.ensure(async () => {
          try {
            await result
            if (current.generation !== generation || !current.mounted) return
            this.assertProvides(current, provided)
          } catch (error) {
            if (current.generation === generation && current.mounted) {
              current.status = "failed"
              current.error = errorMessage(error)
            }
            throw error
          } finally {
            if (current.generation === generation) {
              current.pendingCount = Math.max(0, current.pendingCount - 1)
            }
            this.syncPluginStatus(current)
            this.publish()
          }
        })
      } else {
        try {
          this.assertProvides(current, provided)
        } catch (error) {
          current.status = "failed"
          current.error = errorMessage(error)
          this.publish()
          throw error
        }
        current.status = "active"
        current.error = undefined
        this.publish()
      }
    }
    cordisPlugin.inject = inject

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
    })

    if (shouldRemount) {
      this.start(resolvedManifest.id)
    } else {
      this.publish()
    }
  }

  unregister(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    this.stop(id)
    this.context.registry.delete(plugin.cordisPlugin)
    this.plugins.delete(id)
    this.publish()
  }

  start(id: string): void {
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
      plugin.scope?.dispose()
      this.context.registry.delete(plugin.cordisPlugin)
      plugin.scope = this.context.plugin(plugin.cordisPlugin, resolvedConfig)
      this.syncPluginStatus(plugin)
    } catch (error) {
      plugin.mounted = false
      plugin.status = error instanceof PluginDependencyError ? "registered" : "failed"
      plugin.error = error instanceof PluginDependencyError ? undefined : errorMessage(error)
      this.publish()
      throw error
    }
    this.publish()
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
      plugin.scope?.dispose()
      this.context.registry.delete(plugin.cordisPlugin)
      plugin.scope = undefined
      plugin.status = "failed"
      plugin.error = message
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
    await this.context.events.flush()
    this.syncAllStatuses()
  }

  stop(id: string, cascade = true): void {
    const plugin = this.plugins.get(id)
    if (!plugin || (plugin.status === "disabled" && !plugin.scope && !plugin.mounted)) return
    plugin.generation += 1
    plugin.mounted = false
    plugin.pendingCount = 0
    plugin.status = "disabled"
    plugin.error = undefined
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

  dispose(): void {
    for (const id of Array.from(this.plugins.keys())) this.unregister(id)
    void this.context.stop()
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
    const rawStatus: number = runtimeScope.status
    if (rawStatus === CORDIS_SCOPE_FAILED || runtimeScope.error != null) {
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
