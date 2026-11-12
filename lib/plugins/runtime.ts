import { Context, type ForkScope, type Plugin } from "@cordisjs/core"
import type { PluginContext, PluginDefinition, PluginManifest } from "@ysu/plugin-sdk"

export type PluginSource = "builtin" | "external"
export type PluginStatus = "registered" | "active" | "disabled" | "failed"

const PLUGIN_SERVICES = ["ui", "i18n", "providers", "storage", "http", "native", "assets"]

export interface PluginState {
  manifest: PluginManifest
  source: PluginSource
  status: PluginStatus
  error?: string
}

interface RegisteredPlugin {
  manifest: PluginManifest
  definition: PluginDefinition
  source: PluginSource
  cordisPlugin: Plugin.Function<Context>
  serviceLabels: Record<string, symbol>
  generation: number
  scope?: ForkScope<Context>
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

export type PluginServiceFactory = (ctx: Context, manifest: PluginManifest) => void

export class PluginRuntime {
  readonly context = new Context()
  private readonly plugins = new Map<string, RegisteredPlugin>()
  private readonly listeners = new Set<() => void>()
  private readonly contexts = new WeakMap<Context, PluginContextBinding>()
  private snapshot: readonly PluginState[] = []

  constructor(private readonly configureServices?: PluginServiceFactory) {
    for (const service of PLUGIN_SERVICES) this.context.provide(service)
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

  register(manifest: PluginManifest, definition: PluginDefinition, source: PluginSource): void {
    const previous = this.plugins.get(manifest.id)
    const wasActive = previous?.status === "active"
    if (previous) {
      this.stop(manifest.id)
      this.context.registry.delete(previous.cordisPlugin)
      this.deleteServiceRecords(previous)
    }

    const serviceLabels = Object.fromEntries(
      PLUGIN_SERVICES.map((service) => [service, Symbol(`${manifest.id}:${service}`)])
    )
    const cordisPlugin: Plugin.Function<Context> = (ctx) => {
      const current = this.plugins.get(manifest.id)
      if (!current) return
      const generation = current.generation
      let isolated = ctx
      for (const service of PLUGIN_SERVICES) {
        isolated = isolated.isolate(service, current.serviceLabels[service])
      }
      this.contexts.set(ctx, { plugin: current, generation })
      this.contexts.set(isolated, { plugin: current, generation })
      this.configureServices?.(isolated, current.manifest)
      const pluginContext = isolated as PluginContext
      if (typeof current.definition === "function") return current.definition(pluginContext)
      return current.definition.apply(pluginContext)
    }
    cordisPlugin.inject = Object.fromEntries(
      PLUGIN_SERVICES.map((service) => [service, { required: false }])
    )
    this.plugins.set(manifest.id, {
      manifest,
      definition,
      source,
      cordisPlugin,
      serviceLabels,
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
    this.deleteServiceRecords(plugin)
    this.plugins.delete(id)
    this.publish()
  }

  start(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error(`Plugin not registered: ${id}`)
    if (plugin.scope?.isActive && plugin.status === "active") return
    try {
      plugin.generation += 1
      plugin.scope?.dispose()
      plugin.scope = this.context.plugin(plugin.cordisPlugin)
      plugin.status = "active"
      plugin.error = undefined
    } catch (error) {
      plugin.status = "failed"
      plugin.error = errorMessage(error)
      this.publish()
      throw error
    }
    this.publish()
  }

  async startAndWait(id: string): Promise<void> {
    this.start(id)
    await Promise.all(Array.from(this.context.lifecycle._tasks))
    const state = this.get(id)
    if (state?.status === "failed") throw new Error(state.error)
  }

  stop(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    plugin.generation += 1
    plugin.scope?.dispose()
    plugin.scope = undefined
    plugin.status = "disabled"
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

  private deleteServiceRecords(plugin: RegisteredPlugin): void {
    for (const label of Object.values(plugin.serviceLabels)) {
      delete this.context[Context.store][label]
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
