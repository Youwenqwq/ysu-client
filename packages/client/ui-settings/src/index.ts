import {
  definePlugin,
  PLUGIN_API_VERSION,
  pluginPageHref,
  type PluginLocale,
  type PluginManifest,
  type PluginSettingsCategory,
} from "@orahako/sdk"
import "./slots-declare"
import { settingsDictionary } from "./dictionary"
import { UserAgentDebugPanel } from "./debug-panel"
import { CategoryPage, categoryPageChildren } from "./pages/category-page"
import { SettingsPage, settingsPageChildren } from "./pages/settings-page"
import {
  applyCustomUserAgentHeader,
  normalizeCustomUserAgent,
  resolveEffectiveUserAgent,
  settingsStore,
  type SettingsStoreState,
} from "./store"
import { resolveContributionText } from "./translate-helper"

export {
  applyCustomUserAgentHeader,
  normalizeCustomUserAgent,
  resolveEffectiveUserAgent,
  settingsDictionary,
  settingsStore,
  type SettingsStoreState,
}

export const SETTINGS_PLUGIN_ID = "orahako.settings"

export const manifest: PluginManifest = {
  id: SETTINGS_PLUGIN_ID,
  name: "设置",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  providerIndependent: true,
  required: true,
  inject: ["ui", "slots", "settings", "router", "i18n", "storage", "http"],
}

function readDefaultBrowserUserAgent(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent : ""
}

export const uiSettingsPlugin = definePlugin({
  manifest,
  inject: ["ui", "slots", "settings", "router", "i18n", "storage", "http"] as const,
  apply(ctx) {
    const store = settingsStore.create(ctx.storage)
    ctx.effect(() => () => {
      store.dispose()
    })

    ctx.on("http/request", (request) =>
      applyCustomUserAgentHeader(request, store.source.getSnapshot())
    )

    const resolveCategoryTitle = (category: PluginSettingsCategory, locale: PluginLocale): string =>
      resolveContributionText(
        category.dictionary,
        category.titleKey,
        category.title ?? category.id,
        locale,
        ctx.i18n
      )

    const resolveCategoryDescription = (
      category: PluginSettingsCategory,
      locale: PluginLocale
    ): string =>
      resolveContributionText(
        category.dictionary,
        category.descriptionKey,
        category.description,
        locale,
        ctx.i18n
      )

    ctx.ui.registerPage(
      {
        id: "settings",
        route: "settings",
        title: "设置",
        titleKey: "title",
        requiresProvider: false,
        parent: "me",
        dictionary: settingsDictionary,
        children: settingsPageChildren,
        store,
        inject: () => ({
          hooks: {
            categories: ctx.settings.state,
          },
          setLocale: (locale: PluginLocale) => {
            ctx.i18n.setLocale(locale)
          },
          categoryHref: (categoryId: string) =>
            ctx.router.href(
              pluginPageHref(SETTINGS_PLUGIN_ID, "category", { category: categoryId })
            ),
          navigateToCategory: (categoryId: string) => {
            ctx.router.push({
              pluginId: SETTINGS_PLUGIN_ID,
              pageId: "category",
              params: { category: categoryId },
            })
          },
          aboutHref: ctx.router.href({ route: "about" }),
          navigateToAbout: () => {
            ctx.router.push({ route: "about" })
          },
          resolveCategoryTitle,
          resolveCategoryDescription,
          onSelectStartupPage: (route: string) => {
            ctx.emit("shell/landing-preference", route)
          },
          getDefaultUserAgent: readDefaultBrowserUserAgent,
        }),
      },
      SettingsPage
    )

    ctx.ui.registerPage(
      {
        id: "category",
        title: "插件设置",
        titleKey: "sectionPluginSettings",
        requiresProvider: false,
        parent: "settings",
        dictionary: settingsDictionary,
        children: categoryPageChildren,
        inject: () => ({
          hooks: {
            location: ctx.router.current,
            categories: ctx.settings.state,
          },
          settingsHref: ctx.router.href({ route: "settings" }),
          navigateToSettings: () => {
            ctx.router.push({ route: "settings" })
          },
          resolveCategoryTitle,
          resolveCategoryDescription,
        }),
      },
      CategoryPage
    )

    ctx.slots.inject("debug.panels", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "settings-user-agent-debug",
          slot: "debug.panels",
          order: 20,
          dictionary: settingsDictionary,
          store,
          inject: () => ({
            getDefaultUserAgent: readDefaultBrowserUserAgent,
          }),
        },
        UserAgentDebugPanel
      )
    )
  },
})

export const settingsPlugin = uiSettingsPlugin
export default uiSettingsPlugin
