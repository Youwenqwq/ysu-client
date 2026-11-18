import {
  Context,
  definePlugin,
  isScopedPluginService,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type PluginLocale,
  type PluginManifest,
  type PluginStorageService,
} from "@orahako/sdk"
import { I18N_RUNTIME_PLUGIN_ID, PluginI18nRegistry } from "./registry"

export interface I18nRuntimeConfig {
  readonly defaultLocale?: PluginLocale
  readonly [key: string]: unknown
}

function isPluginStorageService(value: unknown): value is PluginStorageService {
  return typeof value === "object" && value !== null && "local" in value && "secure" in value
}

function resolveOptionalLocalStorage(ctx: Context, manifest: PluginManifest) {
  const raw: unknown = ctx.get("storage")
  if (!raw) return undefined
  if (isScopedPluginService(raw)) {
    const scoped = raw[PLUGIN_SERVICE_SCOPE](ctx, manifest)
    return isPluginStorageService(scoped) ? scoped.local : undefined
  }
  return isPluginStorageService(raw) ? raw.local : undefined
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
  apply(ctx, config: I18nRuntimeConfig = {}) {
    const cordisCtx = ctx instanceof Context ? ctx : undefined
    const initialStorage = cordisCtx
      ? resolveOptionalLocalStorage(cordisCtx, i18nManifest)
      : undefined
    const registry = new PluginI18nRegistry({
      ...(config.defaultLocale !== undefined ? { defaultLocale: config.defaultLocale } : {}),
      ...(initialStorage !== undefined ? { storage: initialStorage } : {}),
    })

    if (cordisCtx && !initialStorage) {
      ctx.on("internal/service", (name: string) => {
        if (name !== "storage") return
        const lateStorage = resolveOptionalLocalStorage(cordisCtx, i18nManifest)
        if (lateStorage) {
          registry.attachStorage(lateStorage)
        }
      })
    }

    ctx.effect(() => () => {
      registry.dispose()
    })
    ctx.set("i18n", registry)
  },
})
