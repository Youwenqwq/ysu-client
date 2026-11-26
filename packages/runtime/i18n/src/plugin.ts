import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginLocale,
  type PluginManifest,
} from "@orahako/sdk"
import { I18N_RUNTIME_PLUGIN_ID, PluginI18nRegistry } from "./registry"

export interface I18nRuntimeConfig {
  readonly defaultLocale?: PluginLocale
  readonly [key: string]: unknown
}

const i18nManifest: PluginManifest = {
  id: I18N_RUNTIME_PLUGIN_ID,
  name: "多语言注册表",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "runtime",
  entry: "index.js",
  description: "插件翻译词典与语言状态注册表",
  provides: ["i18n"],
}

export const i18nRegistryPlugin = definePlugin({
  manifest: i18nManifest,
  configSchema: {
    type: "object",
    properties: {
      defaultLocale: {
        type: "string",
        enum: ["zh", "en"],
      },
    },
    additionalProperties: false,
  },
  optionalInject: ["storage"],
  apply(ctx, config: I18nRuntimeConfig = {}) {
    // Kernel remounts this plugin when storage appears, is replaced or revoked;
    // the registry then hydrates from the new backend and writes only to it.
    const registry = new PluginI18nRegistry({
      ...(config.defaultLocale !== undefined ? { defaultLocale: config.defaultLocale } : {}),
      ...(ctx.storage !== undefined ? { storage: ctx.storage.local } : {}),
    })

    ctx.effect(() => () => {
      registry.dispose()
    })
    ctx.set("i18n", registry)
  },
})
