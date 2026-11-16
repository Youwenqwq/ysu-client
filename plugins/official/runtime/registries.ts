import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
} from "@orahako/plugin-sdk"
import { PluginI18nRegistry } from "./registries/i18n"
import { PluginNotificationRegistry } from "./registries/notifications"
import { PluginSettingsRegistry } from "./registries/settings"
import { PluginSlotRegistry } from "./registries/slots"
import { PluginUIRegistry } from "./registries/ui"

interface RuntimeRegistryOptions {
  /** Root Cordis service name, which is also the manifest's provided service. */
  service: string
  name: string
  description: string
  create: () => object
}

/**
 * Manifest ids allow lowercase DNS labels only, so a camelCase service name
 * becomes a kebab-case id: `hostLifecycle` → `orahako.runtime.host-lifecycle`.
 */
function runtimePluginId(service: string): string {
  return `orahako.runtime.${service.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/**
 * Composes one root registry as an ordinary runtime plugin. The registry
 * instance belongs to that plugin scope: consumers reach it through
 * `manifest.inject`, and its scoped facade attributes registrations to them.
 */
function runtimeRegistry({
  service,
  name,
  description,
  create,
}: RuntimeRegistryOptions): CompositionPlugin {
  return {
    manifest: {
      id: runtimePluginId(service),
      name,
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      entry: "index.js",
      description,
      provides: [service],
    },
    definition: definePlugin((ctx) => {
      ctx.set(service, create())
    }),
  }
}

export const uiRegistryPlugin = runtimeRegistry({
  service: "ui",
  name: "界面注册表",
  description: "插件页面、导航、主题、概览组件与 Shell 的根注册表",
  create: () => new PluginUIRegistry(),
})

export const slotRegistryPlugin = runtimeRegistry({
  service: "slots",
  name: "插槽注册表",
  description: "插件插槽声明与贡献的根注册表",
  create: () => new PluginSlotRegistry(),
})

export const settingsRegistryPlugin = runtimeRegistry({
  service: "settings",
  name: "设置注册表",
  description: "插件设置分类的根注册表",
  create: () => new PluginSettingsRegistry(),
})

export const notificationRegistryPlugin = runtimeRegistry({
  service: "notifications",
  name: "通知渠道注册表",
  description: "插件通知渠道的根注册表",
  create: () => new PluginNotificationRegistry(),
})

export const i18nRegistryPlugin = runtimeRegistry({
  service: "i18n",
  name: "多语言注册表",
  description: "插件翻译词典的根注册表",
  create: () => new PluginI18nRegistry(),
})

/** Ordered root-service plugins; the official composition spreads this list. */
export const registryRuntimePlugins: readonly CompositionPlugin[] = [
  uiRegistryPlugin,
  slotRegistryPlugin,
  settingsRegistryPlugin,
  notificationRegistryPlugin,
  i18nRegistryPlugin,
]
