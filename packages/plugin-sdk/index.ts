import type { Context } from "@cordisjs/core"
import type { PluginUIService } from "./ui"
import type { PluginSlotService } from "./slots"
import type { PluginI18nService } from "./i18n"
import type { PluginProviderService } from "./providers"
import type { PluginInstallerService } from "./installer"
import type {
  PluginAssetService,
  PluginHttpService,
  PluginLifecycleService,
  PluginNativeService,
  PluginStorageService,
} from "./services"

export type PluginContext = Context & {
  ui: PluginUIService
  slots: PluginSlotService
  i18n: PluginI18nService
  providers: PluginProviderService
  plugins: PluginInstallerService
  storage: PluginStorageService
  http: PluginHttpService
  native: PluginNativeService
  assets: PluginAssetService
  hostLifecycle: PluginLifecycleService
}

export interface PluginObject {
  name?: string
  apply(ctx: PluginContext): void | Promise<void>
}

export type PluginDefinition = PluginObject | ((ctx: PluginContext) => void | Promise<void>)

export function definePlugin<T extends PluginDefinition>(plugin: T): T {
  return plugin
}

export * from "./manifest"
export * from "./ui"
export * from "./slots"
export * from "./i18n"
export * from "./market"
export * from "./academic"
export * from "./providers"
export * from "./provider-base"
export * from "./provider-capabilities"
export * from "./provider-errors"
export * from "./provider-school"
export * from "./services"
export * from "./installer"
export * from "./host"
