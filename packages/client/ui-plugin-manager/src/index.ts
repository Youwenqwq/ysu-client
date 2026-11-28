import { Puzzle } from "lucide-react"
import {
  createObservableSource,
  definePlugin,
  isCapacitor,
  PLUGIN_API_VERSION,
  type MarketplaceIndex,
  type ObservableSource,
  type PluginHostPreferenceSnapshot,
} from "@orahako/sdk"
import type { ProviderRuntimeService } from "@orahako/academic-sdk"
import {
  groupByPluginCategory,
  pluginCategory,
  type PluginCategory,
  type PluginCategoryInput,
} from "./categories"
import { pluginsDictionary, type PluginsDictionary } from "./dictionary"
import {
  PluginsHeaderActions,
  type PluginsHeaderActionsInject,
  type PluginsHeaderActionsProps,
} from "./header-actions"
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
  type PluginManagerPreferencesStoreInstance,
} from "./store"

export {
  groupByPluginCategory,
  pluginCategory,
  pluginManagerPreferencesStore,
  pluginsDictionary,
  PluginsHeaderActions,
  PluginsPage,
  type OptionalProviderSnapshot,
  type PluginCategory,
  type PluginCategoryInput,
  type PluginManagerPreferencesState,
  type PluginManagerPreferencesStore,
  type PluginManagerPreferencesStoreInstance,
  type PluginsDictionary,
  type PluginsHeaderActionsInject,
  type PluginsHeaderActionsProps,
  type PluginsPageInject,
  type PluginsPageProps,
}

const EMPTY_LOAD_ERRORS: ReadonlyMap<string, string> = new Map()

const EMPTY_PREFERENCE_SNAPSHOT: PluginHostPreferenceSnapshot = {
  marketEnabled: false,
  customMarketUrl: "",
}

const STATIC_PREFERENCE_SOURCE: ObservableSource<PluginHostPreferenceSnapshot> = {
  getSnapshot: () => EMPTY_PREFERENCE_SNAPSHOT,
  subscribe: () => () => {},
}

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

function projectProviderSnapshot(provider: ProviderRuntimeLike): OptionalProviderSnapshot {
  const snap = provider.state.getSnapshot()
  const supportedPlugins = snap.provider?.supportedPlugins
  return {
    schoolId: snap.provider?.id ?? snap.schoolId,
    ...(supportedPlugins !== undefined ? { supportedPlugins } : {}),
  }
}

interface ProviderProjection {
  readonly source: ObservableSource<OptionalProviderSnapshot>
  dispose(): void
}

function createProviderProjection(provider: unknown): ProviderProjection {
  if (!isProviderRuntimeLike(provider)) {
    return { source: STATIC_PROVIDER_SOURCE, dispose: () => {} }
  }
  // The projection owns the derived snapshot. Updates happen on the provider's
  // subscription only, so `getSnapshot` stays pure for React.
  const projected = createObservableSource<OptionalProviderSnapshot>(
    projectProviderSnapshot(provider),
    (left, right) =>
      left.schoolId === right.schoolId && left.supportedPlugins === right.supportedPlugins
  )
  const unsubscribe = provider.state.subscribe(() => {
    projected.set(projectProviderSnapshot(provider))
  })
  return { source: projected, dispose: unsubscribe }
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
    inject: ["ui", "slots", "router", "i18n", "storage", "pluginManager", "packageRuntime"],
    description: "管理已安装插件、外部 ZIP 侧载、应用 Shell 选择与插件市场",
  },
  inject: ["ui", "slots", "router", "i18n", "storage", "pluginManager", "packageRuntime"] as const,
  optionalInject: ["provider"] as const,
  apply(ctx) {
    const preferencesStore = pluginManagerPreferencesStore.create(ctx.storage)
    ctx.effect(() => () => preferencesStore.dispose())

    const provider: ProviderRuntimeService | undefined = ctx.provider
    const providerProjection = createProviderProjection(provider)
    ctx.effect(() => () => providerProjection.dispose())

    ctx.i18n.register({
      zh: { ...pluginsDictionary.zh, plugins: pluginsDictionary.zh },
      en: { ...pluginsDictionary.en, plugins: pluginsDictionary.en },
    })

    const preferenceSource: ObservableSource<PluginHostPreferenceSnapshot> =
      ctx.packageRuntime.preferenceState ?? STATIC_PREFERENCE_SOURCE

    ctx.slots.inject("shell.header.actions", () =>
      ctx.slots.register(
        {
          id: "plugins-header-actions",
          slot: "shell.header.actions",
          dictionary: pluginsDictionary,
          store: preferencesStore,
          inject: (): PluginsHeaderActionsInject => ({
            hooks: {
              location: ctx.router.current,
              preference: preferenceSource,
            },
            pluginId: pluginManagerPlugin.manifest.id,
            defaultMarketUrl: ctx.packageRuntime.marketUrl?.(),
            setMarketEnabled: (enabled: boolean) => ctx.packageRuntime.setMarketEnabled?.(enabled),
            setCustomMarketUrl: (url: string) => ctx.packageRuntime.setCustomMarketUrl?.(url),
          }),
        },
        PluginsHeaderActions
      )
    )

    ctx.ui.registerPage(
      {
        id: "plugins",
        route: "plugins",
        title: "插件",
        titleKey: "title",
        requiresProvider: false,
        parent: "me",
        dictionary: pluginsDictionary,
        store: preferencesStore,
        inject: (): PluginsPageInject => {
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
            applyPluginBundle: (
              pluginIds: readonly string[],
              index: MarketplaceIndex,
              marketBaseUrl: string
            ) => ctx.packageRuntime.applyPluginBundle(pluginIds, index, marketBaseUrl),
            getMarketUrl: () => ctx.packageRuntime.marketUrl?.(),
            getAppVersion: () => ctx.packageRuntime.appVersion?.() ?? "0.0.0",
            getNativeCapabilities: () => ctx.packageRuntime.nativeCapabilities(),
            getLoadErrors: () => ctx.packageRuntime.loadErrors?.() ?? EMPTY_LOAD_ERRORS,
            getActiveShell: () => ctx.packageRuntime.getActiveShell?.(),
            getDefaultShell: () => ctx.packageRuntime.defaultShell?.(),
            setActiveShell: (shellId: string | undefined) =>
              ctx.packageRuntime.setActiveShell?.(shellId),
            getActiveTheme: () => ctx.packageRuntime.getActiveTheme?.(),
            setActiveTheme: (themeId: string | undefined) =>
              ctx.packageRuntime.setActiveTheme?.(themeId),
            openThemeSettings: () => {
              ctx.router.push({ route: "theme" })
            },
            isSafeMode: () => ctx.packageRuntime.safeMode?.() ?? false,
            getPlatform: () => (isCapacitor() ? "android" : "web"),
            hooks: {
              states: ctx.pluginManager.state,
              ui: ctx.ui.state,
              provider: providerProjection.source,
              preference: preferenceSource,
            },
          }
        },
      },
      PluginsPage
    )

    ctx.ui.registerNavigation({
      id: "plugins",
      title: "插件",
      titleKey: "title",
      page: "plugins",
      icon: Puzzle,
      group: "account",
      order: 90,
    })
  },
})

export default pluginManagerPlugin
