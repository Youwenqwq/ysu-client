import {
  definePlugin,
  parseRouteLocation,
  PLUGIN_API_VERSION,
  type PluginLocale,
  type PluginManifest,
  type PluginPageContribution,
  type PluginUIServiceSnapshot,
  type RouteLocation,
} from "@orahako/sdk"
import "./slots-declare"
import { AppearanceSettingsSection } from "./appearance-settings"
import { BackgroundMediaController, isRenderableBackgroundUrl } from "./background-media"
import {
  attachDeepLinkListener,
  attachNativeWebViewLifecycle,
  NATIVE_WEBVIEW_CAPABILITY,
  parseDeepLink,
  type CapacitorAppUrlAdapter,
} from "./deep-link"
import { DefaultShell, defaultShellChildren, type ResolvedShellChrome } from "./default-shell"
import { shellDictionary } from "./dictionary"
import {
  buildMobileBottomTabs,
  buildSidebarGroups,
  isPagePrimary,
  resolveActivePageForLocation,
  resolveActiveScopedNavId,
  resolveEntryText,
  type AppNavContribution,
  type ShellMobileTab,
  type ShellSidebarGroup,
  type ShellSidebarItem,
} from "./nav-helpers"
import { BackgroundPage } from "./pages/background-page"
import {
  appearanceStore,
  buildCardStyleCss,
  clampSidebarWidth,
  computeCardBgOpacity,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type AppearanceStoreState,
  type BackgroundStyle,
  type CardStyle,
  type ColorMode,
} from "./store"

export {
  appearanceStore,
  attachDeepLinkListener,
  attachNativeWebViewLifecycle,
  BackgroundMediaController,
  buildCardStyleCss,
  buildMobileBottomTabs,
  buildSidebarGroups,
  clampSidebarWidth,
  computeCardBgOpacity,
  DEFAULT_SIDEBAR_WIDTH,
  isPagePrimary,
  isRenderableBackgroundUrl,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  NATIVE_WEBVIEW_CAPABILITY,
  parseDeepLink,
  resolveActivePageForLocation,
  resolveActiveScopedNavId,
  shellDictionary,
  type AppearanceStoreState,
  type AppNavContribution,
  type BackgroundStyle,
  type CapacitorAppUrlAdapter,
  type CardStyle,
  type ColorMode,
  type ResolvedShellChrome,
  type ShellMobileTab,
  type ShellSidebarGroup,
  type ShellSidebarItem,
}

export const SHELL_PLUGIN_ID = "orahako.shell"
export const DEFAULT_SHELL_ID = "default"

export interface ShellPluginConfig {
  readonly appName?: string
  readonly appNameEn?: string
  readonly deepLinkScheme?: string
  readonly [key: string]: unknown
}

export const manifest: PluginManifest = {
  id: SHELL_PLUGIN_ID,
  name: "酸橙盒界面",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "shell",
  entry: "index.js",
  required: true,
  inject: ["ui", "slots", "router", "navigation", "i18n", "storage", "native"],
}

export const uiShellPlugin = definePlugin<
  readonly ["ui", "slots", "router", "navigation", "i18n", "storage", "native"],
  ShellPluginConfig
>({
  manifest,
  inject: ["ui", "slots", "router", "navigation", "i18n", "storage", "native"] as const,
  configSchema: {
    type: "object",
    properties: {
      appName: { type: "string" },
      appNameEn: { type: "string" },
      deepLinkScheme: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: ShellPluginConfig = {}) {
    const appNameZh = config.appName ?? "酸橙盒"
    const appNameEn = config.appNameEn ?? "Orahako"
    const deepLinkScheme = config.deepLinkScheme ?? "orahako"

    const store = appearanceStore.create(ctx.storage)
    const media = new BackgroundMediaController({
      isNative: () => ctx.native.isNative,
    })

    const unsubscribeStore = store.source.subscribe(() => {
      void media.syncToken(store.source.getSnapshot().backgroundImage)
    })
    void media.syncToken(store.source.getSnapshot().backgroundImage)

    ctx.on("shell/landing-preference", (route: string) => {
      store.actions.setDefaultLandingPage(route)
    })

    const disposeWebViewLifecycle = attachNativeWebViewLifecycle({
      native: ctx.native,
      getLocale: () => ctx.i18n.getLocale(),
    })

    const disposeDeepLinks = attachDeepLinkListener({
      isNative: () => ctx.native.isNative,
      scheme: deepLinkScheme,
      navigation: ctx.navigation,
      router: ctx.router,
    })

    ctx.effect(() => () => {
      disposeDeepLinks()
      disposeWebViewLifecycle()
      unsubscribeStore()
      media.dispose()
      store.dispose()
    })

    const getAppName = (locale: PluginLocale): string => (locale === "en" ? appNameEn : appNameZh)

    const groupLabelFor = (group: string): string => {
      const translateLocal = ctx.i18n.translator(shellDictionary)
      switch (group) {
        case "main":
          return translateLocal("shell.groupMain")
        case "academic":
          return translateLocal("shell.groupAcademic")
        case "platform":
          return translateLocal("shell.groupPlatform")
        case "fees":
          return translateLocal("shell.groupFees")
        case "extras":
          return translateLocal("shell.groupExtras")
        case "plugins":
          return translateLocal("shell.groupPlugins")
        case "account":
          return translateLocal("shell.groupAccount")
        default:
          return group
      }
    }

    const resolveChrome = (
      location: RouteLocation,
      uiSnapshot: PluginUIServiceSnapshot,
      locale: PluginLocale
    ): ResolvedShellChrome => {
      const landingPref = store.source.getSnapshot().defaultLandingPage
      const activePage = resolveActivePageForLocation(
        location,
        uiSnapshot.pages,
        ctx.navigation,
        landingPref
      )

      const pageTitle = activePage
        ? resolveEntryText(
            activePage.dictionary,
            activePage.titleKey,
            activePage.title ?? activePage.id,
            locale,
            (key, loc) => ctx.i18n.t(key, undefined, loc)
          )
        : getAppName(locale)

      const showBack = activePage ? !isPagePrimary(activePage, uiSnapshot.navigation) : false
      const fullscreen = Boolean(activePage?.fullscreen)
      const routeKey = activePage
        ? `${location.pathname}?${activePage.pluginId}:${activePage.id}`
        : location.href

      const appNav = ctx.navigation.forScope<AppNavContribution>("app")
      const { mainGroups, accountItems } = buildSidebarGroups({
        appNav,
        pages: uiSnapshot.pages,
        activePage,
        locale,
        groupLabel: groupLabelFor,
        translateShared: (key, loc) => ctx.i18n.t(key, undefined, loc),
        formatHref: (rawHref) => ctx.router.href(rawHref),
        pushTarget: (pluginId, pageId, params) => {
          ctx.router.push({
            pluginId,
            pageId,
            ...(params !== undefined ? { params } : {}),
          })
        },
      })

      const { tabs: mobileTabs } = buildMobileBottomTabs({
        navigation: ctx.navigation,
        pages: uiSnapshot.pages,
        activePage,
        locationParams: location.params,
        locale,
        translateShared: (key, loc) => ctx.i18n.t(key, undefined, loc),
        formatHref: (rawHref) => ctx.router.href(rawHref),
        replaceTarget: (pluginId, pageId, params) => {
          ctx.router.replace({
            pluginId,
            pageId,
            ...(params !== undefined ? { params } : {}),
          })
        },
      })

      return {
        activePage,
        pageTitle,
        showBack,
        fullscreen,
        routeKey,
        mainGroups,
        accountItems,
        mobileTabs,
      }
    }

    const handleBack = (activePage: PluginPageContribution | undefined): void => {
      const before = ctx.router.current.getSnapshot().href
      ctx.router.back()
      const after = ctx.router.current.getSnapshot().href
      if (after === before && activePage?.parent) {
        const parentInSamePlugin = ctx.ui
          .getSnapshot()
          .pages.find(
            (candidate) =>
              candidate.pluginId === activePage.pluginId && candidate.id === activePage.parent
          )
        if (parentInSamePlugin) {
          ctx.router.push({ pluginId: parentInSamePlugin.pluginId, pageId: parentInSamePlugin.id })
          return
        }
        if (ctx.navigation.resolve(activePage.parent)) {
          ctx.router.push({ route: activePage.parent })
        }
      }
    }

    const applyLandingPreference = (landingRoute: string): void => {
      const current = ctx.router.current.getSnapshot()
      if (current.route || current.pluginId) return
      const landingHref = ctx.navigation.landing(landingRoute)
      if (!landingHref) return
      if (parseRouteLocation(ctx.router.href(landingHref)).href !== current.href) {
        ctx.router.replace(landingHref)
      }
    }

    ctx.ui.registerShell(
      {
        id: DEFAULT_SHELL_ID,
        name: appNameZh,
        dictionary: shellDictionary,
        children: defaultShellChildren,
        store,
        inject: () => ({
          hooks: {
            location: ctx.router.current,
            ui: ctx.ui.state,
            navRevision: ctx.navigation.state,
            backgroundUrl: media.urlSource,
            storeHydrated: store.hydrated,
          },
          getAppName,
          resolveChrome,
          settingsHref: ctx.router.href({ route: "settings" }),
          navigateToSettings: () => {
            ctx.router.push({ route: "settings" })
          },
          handleBack,
          applyLandingPreference,
        }),
      },
      DefaultShell
    )

    ctx.ui.registerPage(
      {
        id: "background",
        route: "background",
        title: "背景图设置",
        titleKey: "background.title",
        requiresProvider: false,
        parent: "settings",
        dictionary: shellDictionary,
        store,
        inject: () => ({
          hooks: {
            backgroundUrl: media.urlSource,
          },
          saveBackgroundDataUrl: (dataUrl: string) => media.save(dataUrl),
          removeBackground: () => media.remove(),
        }),
      },
      BackgroundPage
    )

    ctx.slots.inject("settings.appearance", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "shell-appearance-controls",
          slot: "settings.appearance",
          order: 10,
          dictionary: shellDictionary,
          store,
          inject: () => ({
            hooks: {
              ui: ctx.ui.state,
            },
            backgroundHref: ctx.router.href({ route: "background" }),
            navigateToBackground: () => {
              ctx.router.push({ route: "background" })
            },
          }),
        },
        AppearanceSettingsSection
      )
    )
  },
})

export const shellPlugin = uiShellPlugin
export default uiShellPlugin
