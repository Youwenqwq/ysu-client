import { Puzzle } from "lucide-react"
import {
  createObservableSource,
  definePlugin,
  isCapacitor,
  PLUGIN_API_VERSION,
  type Context,
  type MarketplaceIndex,
  type ObservableSource,
} from "@orahako/sdk"
import {
  groupByPluginCategory,
  pluginCategory,
  type PluginCategory,
  type PluginCategoryInput,
} from "./categories"
import { pluginsDictionary, type PluginsDictionary } from "./dictionary"
import {
  PluginsPage,
  type OptionalProviderSnapshot,
  type PluginsPageInject,
  type PluginsPageProps,
} from "./page"
import {
  pluginManagerPreferencesStore,
  type PluginManagerPreferencesState,
  type PluginManagerPreferencesStore,
} from "./store"

export {
  groupByPluginCategory,
  pluginCategory,
  pluginManagerPreferencesStore,
  pluginsDictionary,
  PluginsPage,
  type OptionalProviderSnapshot,
  type PluginCategory,
  type PluginCategoryInput,
  type PluginManagerPreferencesState,
  type PluginManagerPreferencesStore,
  type PluginsDictionary,
  type PluginsPageInject,
  type PluginsPageProps,
}

const EMPTY_LOAD_ERRORS: ReadonlyMap<string, string> = new Map()

const STATIC_PROVIDER_SNAPSHOT: OptionalProviderSnapshot = {
  schoolId: null,
}

const STATIC_PROVIDER_SOURCE: ObservableSource<OptionalProviderSnapshot> = {
  getSnapshot: () => STATIC_PROVIDER_SNAPSHOT,
  subscribe: () => () => {},
}

interface ProviderRuntimeLike {
  readonly state: ObservableSource<{
    readonly schoolId: string | null
    readonly provider: {
      readonly id: string
      readonly supportedPlugins?: readonly string[]
    } | null
  }>
}

function isProviderRuntimeLike(value: unknown): value is ProviderRuntimeLike {
  if (typeof value !== "object" || value === null || !("state" in value)) return false
  const state: unknown = value.state
  return (
    typeof state === "object" &&
    state !== null &&
    "getSnapshot" in state &&
    typeof state.getSnapshot === "function" &&
    "subscribe" in state &&
    typeof state.subscribe === "function"
  )
}

function projectProviderSource(registrantCtx: Context): ObservableSource<OptionalProviderSnapshot> {
  const raw: unknown = registrantCtx.get("provider")
  if (!isProviderRuntimeLike(raw)) {
    return STATIC_PROVIDER_SOURCE
  }
  const readProjected = (): OptionalProviderSnapshot => {
    const snap = raw.state.getSnapshot()
    const schoolId = snap.provider?.id ?? snap.schoolId
    const supportedPlugins = snap.provider?.supportedPlugins
    return {
      schoolId,
      ...(supportedPlugins !== undefined ? { supportedPlugins } : {}),
    }
  }
  const projected = createObservableSource<OptionalProviderSnapshot>(readProjected())
  return {
    getSnapshot: () => {
      const next = readProjected()
      const prev = projected.getSnapshot()
      if (prev.schoolId !== next.schoolId || prev.supportedPlugins !== next.supportedPlugins) {
        projected.set(next)
      }
      return projected.getSnapshot()
    },
    subscribe: (listener) => raw.state.subscribe(listener),
  }
}

export const pluginManagerPlugin = definePlugin({
  manifest: {
    id: "orahako.plugin-manager",
    name: "插件管理",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    providerIndependent: true,
    required: true,
    entry: "index.js",
    inject: ["ui", "slots", "router", "i18n", "pluginManager", "packageRuntime"],
    description: "管理已安装插件、外部 ZIP 侧载、应用 Shell 选择与插件市场",
  },
  inject: ["ui", "slots", "router", "i18n", "pluginManager", "packageRuntime"] as const,
  apply(ctx) {
    ctx.i18n.register({
      zh: { plugins: pluginsDictionary.zh },
      en: { plugins: pluginsDictionary.en },
    })

    ctx.ui.registerPage(
      {
        id: "plugins",
        route: "plugins",
        title: "插件",
        titleKey: "plugins.title",
        requiresProvider: false,
        parent: "me",
        dictionary: pluginsDictionary,
        store: pluginManagerPreferencesStore,
        inject: (registrantCtx: Context): PluginsPageInject => {
          const providerSource = projectProviderSource(registrantCtx)
          return {
            enablePlugin: (id: string) => ctx.pluginManager.enable(id),
            disablePlugin: (id: string) => ctx.pluginManager.disable(id),
            isProtected: (id: string) => ctx.pluginManager.isProtected(id),
            listInstalled: () =>
              ctx.packageRuntime.listInstalled
                ? ctx.packageRuntime.listInstalled()
                : Promise.resolve([]),
            installPackage: (input: Uint8Array | ArrayBuffer | Blob) => {
              if (!ctx.packageRuntime.installPackage) {
                throw new Error("Plugin package sideload is unavailable")
              }
              return ctx.packageRuntime.installPackage(input)
            },
            uninstallPlugin: (id: string) => {
              if (!ctx.packageRuntime.uninstall) {
                throw new Error("Plugin uninstall is unavailable")
              }
              return ctx.packageRuntime.uninstall(id)
            },
            installFromUrl: (
              url: string,
              sha256: string,
              expected: { id: string; version: string }
            ) => ctx.packageRuntime.installFromUrl(url, sha256, expected),
            applyPluginBundle: (pluginIds: readonly string[], index: MarketplaceIndex) =>
              ctx.packageRuntime.applyPluginBundle(pluginIds, index),
            getMarketUrl: () => ctx.packageRuntime.marketUrl?.(),
            getAppVersion: () => ctx.packageRuntime.appVersion?.() ?? "0.0.0",
            getNativeCapabilities: () => ctx.packageRuntime.nativeCapabilities(),
            getLoadErrors: () => ctx.packageRuntime.loadErrors?.() ?? EMPTY_LOAD_ERRORS,
            getActiveShell: () => ctx.packageRuntime.getActiveShell?.(),
            setActiveShell: (shellId: string | undefined) =>
              ctx.packageRuntime.setActiveShell?.(shellId),
            isSafeMode: () => ctx.packageRuntime.safeMode?.() ?? false,
            getPlatform: () => (isCapacitor() ? "android" : "web"),
            hooks: {
              states: ctx.pluginManager.state,
              ui: ctx.ui.state,
              provider: providerSource,
            },
          }
        },
      },
      PluginsPage
    )

    ctx.ui.registerNavigation({
      id: "plugins",
      title: "插件",
      titleKey: "plugins.title",
      page: "plugins",
      icon: Puzzle,
      group: "preferences",
      order: 90,
    })
  },
})

export default pluginManagerPlugin
