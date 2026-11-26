import { Activity } from "lucide-react"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  resolveDictionaryMessage,
  type DictionaryMessages,
  type PluginI18nService,
  type PluginLocale,
} from "@orahako/sdk"
import { networkActivityDictionary, type NetworkActivityDictionary } from "./dictionary"
import { HeixiuMascot } from "./mascot"
import { ActivityMascots, type ActivityMascotsProps } from "./mascots"
import { NetworkActivitySettings, type NetworkActivitySettingsProps } from "./settings"
import {
  activitySettingsStore,
  DEFAULT_ACTIVITY_SETTINGS,
  isActivityDensity,
  type ActivityDensity,
  type ActivitySettingsState,
  type ActivitySettingsStore,
} from "./state"
import { formatDuration, NetworkActivityStrip, type NetworkActivityStripProps } from "./strip"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.activity": { kind: "list"; owner: Record<string, never> }
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
  }
}

export {
  ActivityMascots,
  activitySettingsStore,
  DEFAULT_ACTIVITY_SETTINGS,
  formatDuration,
  HeixiuMascot,
  isActivityDensity,
  networkActivityDictionary,
  NetworkActivitySettings,
  NetworkActivityStrip,
  type ActivityDensity,
  type ActivityMascotsProps,
  type ActivitySettingsState,
  type ActivitySettingsStore,
  type NetworkActivityDictionary,
  type NetworkActivitySettingsProps,
  type NetworkActivityStripProps,
}

function isDictionaryMessages(value: unknown): value is DictionaryMessages {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function translateAcrossPlugins(
  i18n: PluginI18nService,
  key: string,
  locale: PluginLocale
): string {
  const merged: unknown = i18n.getDictionary(locale, {})
  if (isDictionaryMessages(merged)) {
    const primary = resolveDictionaryMessage(merged, key)
    if (primary !== undefined) return primary
  }
  const fallbackLocale: PluginLocale = locale === "en" ? "zh" : "en"
  const fallbackMerged: unknown = i18n.getDictionary(fallbackLocale, {})
  if (isDictionaryMessages(fallbackMerged)) {
    const secondary = resolveDictionaryMessage(fallbackMerged, key)
    if (secondary !== undefined) return secondary
  }
  return i18n.t(key, undefined, locale)
}

export const networkActivityPlugin = definePlugin({
  manifest: {
    id: "orahako.network-activity",
    name: "网络活动",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "settings", "i18n", "storage", "http", "router"],
    description: "在顶栏显示当前网络请求与耗时，可切换简洁、详细和调试模式",
  },
  inject: ["slots", "settings", "i18n", "storage", "http", "router"] as const,
  apply(ctx) {
    const storeInstance = activitySettingsStore.create(ctx.storage)
    ctx.effect(() => () => storeInstance.dispose())

    ctx.i18n.register({
      zh: {
        settings: networkActivityDictionary.zh.settings,
        networkActivity: networkActivityDictionary.zh,
      },
      en: {
        settings: networkActivityDictionary.en.settings,
        networkActivity: networkActivityDictionary.en,
      },
    })

    ctx.settings.registerCategory(
      {
        id: "network-activity",
        order: 60,
        title: "网络活动",
        titleKey: "settings.title",
        description: "控制顶栏网络加载提示的详细程度",
        descriptionKey: "settings.description",
        icon: Activity,
        dictionary: networkActivityDictionary,
        store: storeInstance,
      },
      NetworkActivitySettings
    )

    ctx.slots.inject("shell.activity", () =>
      ctx.slots.register(
        {
          id: "activity-strip",
          slot: "shell.activity",
          dictionary: networkActivityDictionary,
          store: storeInstance,
          inject: () => ({
            translateExternal: (key: string, locale: PluginLocale) =>
              translateAcrossPlugins(ctx.i18n, key, locale),
            hooks: {
              activity: ctx.http.activity.state,
            },
          }),
        },
        NetworkActivityStrip
      )
    )

    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          id: "activity-mascots",
          slot: "shell.overlay",
          order: 20,
          store: storeInstance,
          inject: () => ({
            hooks: {
              activity: ctx.http.activity.state,
              location: ctx.router.current,
            },
          }),
        },
        ActivityMascots
      )
    )
  },
})

export default networkActivityPlugin
