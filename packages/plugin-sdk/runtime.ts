import type { Context, Inject } from "@cordisjs/core"
import type { PluginManifest } from "./manifest"
import type { PluginPackageRuntime, PluginManagerService } from "./kernel"
import type { PluginNavigationService } from "./navigation"
import type { PluginUIService } from "./ui"
import type { PluginSlotService } from "./slots"
import type { PluginI18nService } from "./i18n"

import type { PluginInstallerService } from "./installer"
import type { PluginSettingsService } from "./settings"

import type {
  PluginAssetService,
  PluginHttpService,
  PluginNativeService,
  PluginNotificationService,
  PluginStorageService,
} from "./services"

export type PluginConfig = Record<string, unknown>

export type PluginContext = Context & {
  ui: PluginUIService
  slots: PluginSlotService
  i18n: PluginI18nService

  plugins: PluginInstallerService
  packageRuntime: PluginPackageRuntime
  pluginManager: PluginManagerService
  storage: PluginStorageService
  http: PluginHttpService
  native: PluginNativeService
  assets: PluginAssetService
  notifications: PluginNotificationService
  settings: PluginSettingsService

  navigation: PluginNavigationService
}

export interface PluginDefinitionBase {
  name?: string
  inject?: Inject
}

export interface PluginObject<C extends PluginConfig = PluginConfig> extends PluginDefinitionBase {
  apply(ctx: PluginContext, config: C): void | Promise<void>
}

export type PluginFunction<C extends PluginConfig = PluginConfig> = ((
  ctx: PluginContext,
  config: C
) => void | Promise<void>) &
  PluginDefinitionBase

export type PluginDefinition<C extends PluginConfig = PluginConfig> =
  | PluginObject<C>
  | PluginFunction<C>

export function definePlugin<T extends PluginDefinition<PluginConfig>>(plugin: T): T {
  return plugin
}

/**
 * A root service may implement this protocol when consumers need a facade
 * bound to their own plugin identity. The runtime recreates the facade whenever
 * Cordis restarts the consumer after a root-service replacement.
 */
export const PLUGIN_SERVICE_SCOPE = Symbol.for("orahako.plugin-service.scope")

export interface ScopedPluginService<T = unknown> {
  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): T
}

export function isScopedPluginService(value: unknown): value is ScopedPluginService {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && PLUGIN_SERVICE_SCOPE in value
}

/**
 * Attaches disposal before publishing a registration. A continuation holding a
 * disposed plugin context therefore fails before it can leak global state.
 */
export function trackPluginRegistration(ctx: Context, register: () => () => void): () => void {
  let active = true
  let dispose = () => {}
  const onDispose = () => {
    if (!active) return
    active = false
    dispose()
  }
  const unregister = ctx.on("dispose", onDispose)
  try {
    dispose = register()
  } catch (error) {
    unregister()
    throw error
  }
  return () => {
    if (!active) return
    active = false
    unregister()
    dispose()
  }
}
