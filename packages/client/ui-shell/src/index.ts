import {
  definePlugin,
  PLUGIN_API_VERSION,
  resolveContributionText,
  type AppearanceColorMode,
  type AppearanceSnapshot,
  type ObservableSource,
  type PluginHostPreferenceSnapshot,
  type PluginLocale,
  type PluginManifest,
  type PluginPageContribution,
  type PluginUIServiceSnapshot,
  type RouteLocation,
  type RouteTargetInput,
  type SlotName,
} from "@orahako/sdk"
import "./slots-declare"
import { AppearanceSettingsSection } from "./appearance-settings"
import { BackgroundMediaController, isRenderableBackgroundUrl } from "./background-media"
import { DefaultShell, defaultShellChildren, type ResolvedShellChrome } from "./default-shell"
import { shellDictionary } from "./dictionary"
import {
  buildMobileBottomTabs,
  buildSidebarGroups,
  isPagePrimary,
  resolveActivePageForLocation,
  resolveActiveScopedNavId,
  type AppNavContribution,
  type ShellMobileTab,
  type ShellSidebarGroup,
  type ShellSidebarItem,
} from "./nav-helpers"
import { PAGE_TRANSITION_STYLE, resolvePageOutletTransitionMode } from "./page-transition"
import { BackgroundPage } from "./pages/background-page"
import { buildThemePreviewDocument, ThemePage } from "./pages/theme-page"
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
  BackgroundMediaController,
  buildCardStyleCss,
  buildMobileBottomTabs,
  buildSidebarGroups,
  buildThemePreviewDocument,
  clampSidebarWidth,
  computeCardBgOpacity,
  DEFAULT_SIDEBAR_WIDTH,
  isPagePrimary,
  isRenderableBackgroundUrl,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  PAGE_TRANSITION_STYLE,
  resolveActivePageForLocation,
  resolveActiveScopedNavId,
  resolvePageOutletTransitionMode,
  shellDictionary,
  ThemePage,
  type AppearanceStoreState,
  type AppNavContribution,
  type BackgroundStyle,
  type CardStyle,
  type ColorMode,
  type ResolvedShellChrome,
  type ShellMobileTab,
  type ShellSidebarGroup,
  type ShellSidebarItem,
}

export const SHELL_PLUGIN_ID = "orahako.shell"
export const DEFAULT_SHELL_ID = "default"
const DEFAULT_SHELL_QUALIFIED_ID = `${SHELL_PLUGIN_ID}:${DEFAULT_SHELL_ID}`

const EMPTY_PREFERENCE_SNAPSHOT: PluginHostPreferenceSnapshot = {}

const STATIC_PREFERENCE_SOURCE: ObservableSource<PluginHostPreferenceSnapshot> = {
  getSnapshot: () => EMPTY_PREFERENCE_SNAPSHOT,
  subscribe: () => () => {},
}

const STATIC_NULL_APPEARANCE_SOURCE: ObservableSource<AppearanceSnapshot | null> = {
  getSnapshot: () => null,
  subscribe: () => () => {},
}

export interface ShellPluginConfig {
  readonly appName?: string
  readonly appNameEn?: string
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
  inject: ["ui", "slots", "router", "navigation", "i18n", "storage", "native", "packageRuntime"],
}

export const uiShellPlugin = definePlugin<
  readonly ["ui", "slots", "router", "navigation", "i18n", "storage", "native", "packageRuntime"],
  ShellPluginConfig,
  readonly ["appearance"]
>({
  manifest,
  inject: [
    "ui",
    "slots",
    "router",
    "navigation",
    "i18n",
    "storage",
    "native",
    "packageRuntime",
  ] as const,
  optionalInject: ["appearance"] as const,
  configSchema: {
    type: "object",
    properties: {
      appName: { type: "string" },
      appNameEn: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: ShellPluginConfig = {}) {
    const appNameZh = config.appName ?? "酸橙盒"
    const appNameEn = config.appNameEn ?? "Orahako"

    const store = appearanceStore.create(ctx.storage)
    const media = new BackgroundMediaController({
      isNative: () => ctx.native.isNative,
    })

    let lastBackgroundImage = store.source.getSnapshot().backgroundImage
    const unsubscribeStore = store.source.subscribe(() => {
      const nextBackgroundImage = store.source.getSnapshot().backgroundImage
      if (nextBackgroundImage === lastBackgroundImage) return
      lastBackgroundImage = nextBackgroundImage
      void media.syncToken(nextBackgroundImage)
    })
    void media.syncToken(lastBackgroundImage)

    const appearanceSource: ObservableSource<AppearanceSnapshot | null> =
      ctx.appearance?.state ?? STATIC_NULL_APPEARANCE_SOURCE

    const setColorMode = (colorMode: AppearanceColorMode): void => {
      if (ctx.appearance) {
        ctx.appearance.setColorMode(colorMode)
      } else {
        store.actions.setColorMode(colorMode)
      }
    }

    const resolveStartupPage = (): string =>
      ctx.packageRuntime.preferenceState?.getSnapshot().startupPage ??
      ctx.packageRuntime.getStartupPage?.() ??
      ctx.packageRuntime.defaultLanding?.() ??
      ""

    ctx.effect(() => () => {
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
      const activePage = resolveActivePageForLocation(
        location,
        uiSnapshot.pages,
        ctx.navigation,
        resolveStartupPage()
      )

      const pageTitle = activePage
        ? resolveContributionText({
            dictionary: activePage.dictionary,
            key: activePage.titleKey,
            literal: activePage.title ?? activePage.id,
            locale,
            pluginId: activePage.pluginId,
            i18n: ctx.i18n,
          })
        : getAppName(locale)

      const showBack = activePage
        ? !activePage.root && !isPagePrimary(activePage, uiSnapshot.navigation)
        : false
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
        i18n: ctx.i18n,
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
        i18n: ctx.i18n,
        formatHref: (rawHref) => ctx.router.href(rawHref),
        replaceTarget: (pluginId, pageId, params) => {
          ctx.router.replace({
            pluginId,
            pageId,
            ...(params !== undefined ? { params } : {}),
          })
        },
      })

      const showMobileThemeToggle = Boolean(
        activePage?.primary &&
        appNav.some(
          (item) =>
            item.group === "account" &&
            item.pluginId === activePage.pluginId &&
            item.page === activePage.id
        )
      )

      return {
        activePage,
        pageTitle,
        showBack,
        showMobileThemeToggle,
        fullscreen,
        routeKey,
        mainGroups,
        accountItems,
        mobileTabs,
      }
    }

    const resolveBackFallback = (): RouteTargetInput | undefined => {
      const location = ctx.router.current.getSnapshot()
      const snapshot = ctx.ui.getSnapshot()
      const activePage = resolveActivePageForLocation(
        location,
        snapshot.pages,
        ctx.navigation,
        resolveStartupPage()
      )
      if (!activePage || activePage.root || isPagePrimary(activePage, snapshot.navigation)) {
        return undefined
      }

      if (activePage.parent) {
        const parentInSamePlugin = snapshot.pages.find(
          (candidate) =>
            candidate.pluginId === activePage.pluginId && candidate.id === activePage.parent
        )
        if (parentInSamePlugin) {
          return { pluginId: parentInSamePlugin.pluginId, pageId: parentInSamePlugin.id }
        }
        const parentTarget = ctx.navigation.resolve(activePage.parent)
        if (parentTarget) {
          return { pluginId: parentTarget.pluginId, pageId: parentTarget.pageId }
        }
      }

      const primaryTarget = ctx.navigation.primary()
      if (
        primaryTarget &&
        (primaryTarget.pluginId !== activePage.pluginId || primaryTarget.pageId !== activePage.id)
      ) {
        return { pluginId: primaryTarget.pluginId, pageId: primaryTarget.pageId }
      }
      return undefined
    }
    ctx.router.registerBackFallback(resolveBackFallback)

    const handleBack = (_activePage: PluginPageContribution | undefined): void => {
      ctx.router.back()
    }

    const registerBackHandler = (onBack: () => void, priority: number): (() => void) =>
      ctx.router.registerBackGuard(() => {
        onBack()
        return false
      }, priority)

    for (const [name, spec] of Object.entries(defaultShellChildren)) {
      ctx.slots.declare({ name: name as SlotName, kind: spec.kind })
    }

    ctx.ui.registerShell(
      {
        id: DEFAULT_SHELL_ID,
        name: appNameZh,
        supportsThemes: true,
        dictionary: shellDictionary,
        children: defaultShellChildren,
        declareChildren: false,
        store,
        inject: () => ({
          hooks: {
            location: ctx.router.current,
            ui: ctx.ui.state,
            navRevision: ctx.navigation.state,
            backgroundUrl: media.urlSource,
            preference: ctx.packageRuntime.preferenceState ?? STATIC_PREFERENCE_SOURCE,
            appearance: appearanceSource,
          },
          setColorMode,
          getAppName,
          getStartupPreference: () =>
            ctx.packageRuntime.preferenceState?.getSnapshot().startupPage ??
            ctx.packageRuntime.getStartupPage?.() ??
            "",
          resolveChrome,
          settingsHref: ctx.router.href({ route: "settings" }),
          navigateToSettings: () => {
            ctx.router.push({ route: "settings" })
          },
          handleBack,
          registerBackHandler,
        }),
      },
      DefaultShell
    )

    ctx.ui.registerPage(
      {
        id: "theme",
        route: "theme",
        title: "界面主题",
        titleKey: "theme.title",
        requiresProvider: false,
        parent: "settings",
        dictionary: shellDictionary,
        inject: () => ({
          hooks: {
            ui: ctx.ui.state,
            preference: ctx.packageRuntime.preferenceState ?? STATIC_PREFERENCE_SOURCE,
          },
          getActiveTheme: () => ctx.packageRuntime.getActiveTheme?.() ?? "",
          setActiveTheme: (themeId: string | undefined) =>
            ctx.packageRuntime.setActiveTheme?.(themeId),
        }),
      },
      ThemePage
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
              preference: ctx.packageRuntime.preferenceState ?? STATIC_PREFERENCE_SOURCE,
              appearance: appearanceSource,
            },
            setColorMode,
            getActiveShell: () => ctx.packageRuntime.getActiveShell?.(),
            getDefaultShell: () => ctx.packageRuntime.defaultShell?.(),
            setActiveShell: (shellId: string | undefined) =>
              ctx.packageRuntime.setActiveShell?.(shellId),
            defaultShellQualifiedId: DEFAULT_SHELL_QUALIFIED_ID,
            getActiveTheme: () => ctx.packageRuntime.getActiveTheme?.() ?? "",
            themeHref: ctx.router.href({ route: "theme" }),
            navigateToTheme: () => {
              ctx.router.push({ route: "theme" })
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
