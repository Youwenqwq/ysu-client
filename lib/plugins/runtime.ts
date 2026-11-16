import { Context, Inject, type ForkScope, type Plugin } from "@cordisjs/core"
import semver from "semver"
import {
  isScopedPluginService,
  PLUGIN_SERVICE_SCOPE,
  type PluginConfig,
  type PluginContext,
  type PluginDefinition,
  type PluginManifest,
} from "@orahako/plugin-sdk"

export type PluginSource = "builtin" | "external"
export type PluginStatus = "registered" | "starting" | "active" | "disabled" | "failed"

export class PluginDependencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PluginDependencyError"
  }
}

export interface PluginState {
  manifest: PluginManifest
  source: PluginSource
  status: PluginStatus
  error?: string
}

interface RegisteredPlugin {
  manifest: PluginManifest
  definition: PluginDefinition<PluginConfig>
  config: PluginConfig
  source: PluginSource
  cordisPlugin: Plugin.Function<Context, PluginConfig>
  inject: Record<string, Inject.Meta>
  generation: number
  scope?: ForkScope<Context>
  pending?: Promise<void>
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

export class PluginRuntime {
  readonly context = new Context()
  private readonly plugins = new Map<string, RegisteredPlugin>()
  private readonly listeners = new Set<() => void>()
  private readonly contexts = new WeakMap<Context, PluginContextBinding>()
  private snapshot: readonly PluginState[] = []

  constructor() {
    void this.context.start()
    const handleError = (source: Context, error: unknown) => {
      const binding = source === this.context ? undefined : this.contexts.get(source)
      if (!binding || binding.plugin.generation !== binding.generation) return
      binding.plugin.status = "failed"
      binding.plugin.error = errorMessage(error)
      this.publish()
    }
    this.context.on("internal/error", function (this: Context, error: unknown) {
      handleError(this, error)
    })
  }

  register(
    manifest: PluginManifest,
    definition: PluginDefinition<PluginConfig>,
    source: PluginSource,
    config: PluginConfig = {}
  ): void {
    const previous = this.plugins.get(manifest.id)
    const wasActive = previous?.status === "active" || previous?.status === "starting"
    if (previous) {
      this.stop(manifest.id, false)
      this.context.registry.delete(previous.cordisPlugin)
    }

    const inject = {
      ...Inject.resolve(definition.inject),
      ...Object.fromEntries((manifest.inject ?? []).map((name) => [name, { required: true }])),
    }
    const cordisPlugin: Plugin.Function<Context, PluginConfig> = (ctx, resolvedConfig) => {
      const current = this.plugins.get(manifest.id)
      if (!current) return
      const generation = current.generation
      let scoped = ctx
      for (const [name, dependency] of Object.entries(current.inject)) {
        if (!dependency.required) continue
        const service = ctx.get(name)
        if (isScopedPluginService(service)) {
          scoped = scoped.isolate(name)
          scoped.set(name, service[PLUGIN_SERVICE_SCOPE](scoped, current.manifest))
        }
      }
      this.contexts.set(ctx, { plugin: current, generation })
      this.contexts.set(scoped, { plugin: current, generation })
      const pluginContext = scoped as PluginContext

      const result =
        typeof current.definition === "function"
          ? current.definition(pluginContext, resolvedConfig)
          : current.definition.apply(pluginContext, resolvedConfig)
      if (result && typeof result.then === "function") {
        const pending = Promise.resolve(result).then(() => this.assertProvides(current))
        current.pending = pending
        void pending.then(
          () => {
            if (current.generation !== generation || current.pending !== pending) return
            current.pending = undefined
            if (current.status === "starting") current.status = "active"
            this.publish()
          },
          (error) => {
            if (current.pending !== pending || current.generation !== generation) return
            current.pending = undefined
            current.status = "failed"
            current.error = errorMessage(error)
            this.publish()
          }
        )
      }
      if (!result || typeof (result as Promise<void>).then !== "function") {
        this.assertProvides(current)
      }

      return result
    }
    cordisPlugin.inject = inject
    this.plugins.set(manifest.id, {
      manifest,
      definition,
      config,
      source,
      cordisPlugin,
      inject,
      generation: 0,
      status: wasActive ? "active" : "registered",
    })
    if (wasActive) this.start(manifest.id)
    else this.publish()
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
    if (plugin.scope?.isActive && (plugin.status === "active" || plugin.status === "starting"))
      return
    try {
      for (const [dependency, range] of Object.entries(plugin.manifest.requires ?? {})) {
        const installed = this.plugins.get(dependency)
        if (installed?.status !== "active") {
          throw new PluginDependencyError(`Plugin dependency is not active: ${dependency}`)
        }
        if (!semver.satisfies(installed.manifest.version, range)) {
          throw new PluginDependencyError(
            `Plugin dependency ${dependency}@${installed.manifest.version} does not satisfy ${range}`
          )
        }
      }
      for (const [name, dependency] of Object.entries(plugin.inject)) {
        if (dependency.required && this.context.get(name) == null) {
          throw new PluginDependencyError(`Required service is not available: ${name}`)
        }
      }
      plugin.pending = undefined
      plugin.generation += 1
      plugin.scope?.dispose()
      plugin.scope = this.context.plugin(plugin.cordisPlugin, plugin.config)
      if (plugin.scope.error) {
        plugin.status = "failed"
        plugin.error = errorMessage(plugin.scope.error)
      } else {
        plugin.status = plugin.pending ? "starting" : "active"
        plugin.error = undefined
      }
    } catch (error) {
      plugin.status = error instanceof PluginDependencyError ? "registered" : "failed"
      plugin.error = error instanceof PluginDependencyError ? undefined : errorMessage(error)
      this.publish()
      throw error
    }
    this.publish()
  }

  async startAndWait(id: string): Promise<void> {
    this.start(id)
    const plugin = this.plugins.get(id)
    if (plugin?.pending) {
      const timeoutResult = Promise.withResolvers<never>()
      const timeout = setTimeout(() => {
        const error = new Error(`Plugin startup timed out: ${id}`)
        plugin.generation += 1
        plugin.scope?.dispose()
        timeoutResult.reject(error)
      }, 10_000)
      try {
        await Promise.race([plugin.pending, timeoutResult.promise])
      } catch (error) {
        plugin.status = "failed"
        plugin.error = errorMessage(error)
        this.publish()
        throw error
      } finally {
        clearTimeout(timeout)
      }
    }
    const state = this.get(id)
    if (state?.status === "failed") throw new Error(state.error)
  }

  stop(id: string, cascade = true): void {
    const plugin = this.plugins.get(id)
    if (!plugin || (plugin.status === "disabled" && !plugin.scope)) return
    plugin.generation += 1
    plugin.status = "disabled"
    const scope = plugin.scope
    plugin.scope = undefined
    plugin.pending = undefined
    if (cascade) {
      for (const dependent of this.plugins.values()) {
        if (dependent.manifest.requires?.[id]) this.stop(dependent.manifest.id)
      }
    }
    scope?.dispose()
    this.publish()
  }

  get(id: string): PluginState | undefined {
    const plugin = this.plugins.get(id)
    return plugin ? toState(plugin) : undefined
  }

  getSnapshot(): readonly PluginState[] {
    return this.snapshot
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    for (const id of Array.from(this.plugins.keys())) this.unregister(id)
    void this.context.stop()
  }

  private assertProvides(plugin: RegisteredPlugin): void {
    for (const name of plugin.manifest.provides ?? []) {
      if (this.context.get(name) == null) {
        throw new Error(`Plugin ${plugin.manifest.id} did not provide declared service: ${name}`)
      }
    }
  }

  private publish(): void {
    this.snapshot = Array.from(this.plugins.values(), toState).sort((a, b) =>
      a.manifest.name.localeCompare(b.manifest.name)
    )
    for (const listener of this.listeners) listener()
  }
}

function toState(plugin: RegisteredPlugin): PluginState {
  return {
    manifest: plugin.manifest,
    source: plugin.source,
    status: plugin.status,
    error: plugin.error,
  }
}
