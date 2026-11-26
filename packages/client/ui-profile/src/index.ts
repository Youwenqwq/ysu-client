import { User } from "lucide-react"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  pluginPageHref,
  resolveContributionText,
  type PluginAppNavigationDefinition,
  type PluginLocale,
  type PluginManifest,
  type PluginNavigationContribution,
} from "@orahako/sdk"
import "./slots-declare"
import { AppearanceAvatarRow } from "./appearance-avatar-row"
import { AvatarMediaController, isRenderableMediaUrl } from "./avatar-media"
import { profileDictionary } from "./dictionary"
import {
  AboutPage,
  aboutPageChildren,
  DEBUG_TAP_THRESHOLD,
  DEBUG_TAP_WINDOW_MS,
} from "./pages/about-page"
import { AvatarPage } from "./pages/avatar-page"
import { DebugPage, debugPageChildren, type RuntimeDiagnosticsSnapshot } from "./pages/debug-page"
import { MePage, mePageChildren, type ProfileNavGroup } from "./pages/me-page"
import { SidebarProfileFooter } from "./sidebar-footer"
import { profileStore, type ProfileStoreState } from "./store"

export {
  AvatarMediaController,
  DEBUG_TAP_THRESHOLD,
  DEBUG_TAP_WINDOW_MS,
  isRenderableMediaUrl,
  profileDictionary,
  profileStore,
  type ProfileStoreState,
  type RuntimeDiagnosticsSnapshot,
}

export type { PluginProfileService } from "./contract"

export const PROFILE_PLUGIN_ID = "orahako.profile"

export interface ProfilePluginConfig {
  readonly appName?: string
  readonly appNameEn?: string
  readonly appVersion?: string
  readonly appBuild?: string
  readonly repoUrl?: string
  readonly repoLabel?: string
  readonly license?: string
  readonly copyright?: string
  readonly iconUrl?: string
  readonly [key: string]: unknown
}

export const manifest: PluginManifest = {
  id: PROFILE_PLUGIN_ID,
  name: "个人中心",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  providerIndependent: true,
  required: true,
  provides: ["profile"],
  inject: ["ui", "slots", "router", "navigation", "i18n", "storage", "native"],
}

type AppNavigationEntry = PluginNavigationContribution & PluginAppNavigationDefinition

const KNOWN_GROUP_ORDER = ["main", "academic", "platform", "fees", "extras", "plugins"]

export const uiProfilePlugin = definePlugin<
  readonly ["ui", "slots", "router", "navigation", "i18n", "storage", "native"],
  ProfilePluginConfig
>({
  manifest,
  inject: ["ui", "slots", "router", "navigation", "i18n", "storage", "native"] as const,
  configSchema: {
    type: "object",
    properties: {
      appName: { type: "string" },
      appNameEn: { type: "string" },
      appVersion: { type: "string" },
      appBuild: { type: "string" },
      repoUrl: { type: "string" },
      repoLabel: { type: "string" },
      license: { type: "string" },
      copyright: { type: "string" },
      iconUrl: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: ProfilePluginConfig = {}) {
    const appNameZh = config.appName ?? "酸橙盒"
    const appNameEn = config.appNameEn ?? "Orahako"
    const appVersion = config.appVersion ?? "0.0.0"
    const appBuild = config.appBuild ?? "dev"
    const repoUrl = config.repoUrl ?? "https://github.com/Youwenqwq/orahako"
    const repoLabel = config.repoLabel ?? "Youwenqwq/orahako"
    const license = config.license ?? "GPL-3.0"
    const copyright = config.copyright ?? `© ${new Date().getFullYear()} Youwenqwq`

    const store = profileStore.create(ctx.storage)
    const media = new AvatarMediaController({
      isNative: () => ctx.native.isNative,
    })
    ctx.set("profile", { avatarUrl: media.urlSource })

    const unsubscribeStore = store.source.subscribe(() => {
      void media.syncToken(store.source.getSnapshot().avatarToken)
    })
    void media.syncToken(store.source.getSnapshot().avatarToken)

    ctx.effect(() => () => {
      unsubscribeStore()
      media.dispose()
      store.dispose()
    })

    const groupTitleFor = (group: string, locale: PluginLocale): string => {
      const translateLocal = ctx.i18n.translator(profileDictionary)
      void locale
      switch (group) {
        case "main":
          return translateLocal("me.sectionMain")
        case "academic":
          return translateLocal("me.sectionAcademic")
        case "platform":
          return translateLocal("me.sectionPlatforms")
        case "fees":
          return translateLocal("me.sectionFees")
        case "extras":
        case "plugins":
          return translateLocal("me.sectionExtras")
        default:
          return group
      }
    }

    const getFeatureGroups = (locale: PluginLocale): readonly ProfileNavGroup[] => {
      const appItems = ctx.navigation
        .forScope<AppNavigationEntry>("app")
        .filter((item) => item.group !== "account" && item.group !== "main")
      const pages = ctx.ui.getSnapshot().pages

      const normalizedGroups = new Map<string, AppNavigationEntry[]>()
      for (const item of appItems) {
        const bucketKey = item.group === "plugins" ? "extras" : item.group
        const list = normalizedGroups.get(bucketKey)
        if (list) {
          list.push(item)
        } else {
          normalizedGroups.set(bucketKey, [item])
        }
      }

      const sortedKeys = Array.from(normalizedGroups.keys()).sort((a, b) => {
        const aIdx = KNOWN_GROUP_ORDER.indexOf(a)
        const bIdx = KNOWN_GROUP_ORDER.indexOf(b)
        const aRank = aIdx >= 0 ? aIdx : 100
        const bRank = bIdx >= 0 ? bIdx : 100
        return aRank - bRank || a.localeCompare(b)
      })

      return sortedKeys.map((groupKey) => {
        const entries = normalizedGroups.get(groupKey) ?? []
        return {
          group: groupKey,
          title: groupTitleFor(groupKey, locale),
          items: entries.map((item) => {
            const targetPage = pages.find(
              (candidate) => candidate.pluginId === item.pluginId && candidate.id === item.page
            )
            const rawHref = pluginPageHref(item.pluginId, item.page, item.params)
            return {
              id: `${item.pluginId}:${item.id}`,
              href: ctx.router.href(rawHref),
              label: resolveContributionText({
                dictionary: targetPage?.dictionary,
                key: item.titleKey,
                literal: item.title ?? targetPage?.title ?? item.id,
                locale,
                pluginId: item.pluginId,
                i18n: ctx.i18n,
              }),
              icon: item.icon,
              onNavigate: () => {
                ctx.router.push({
                  pluginId: item.pluginId,
                  pageId: item.page,
                  ...(item.params !== undefined ? { params: item.params } : {}),
                })
              },
            }
          }),
        }
      })
    }

    ctx.ui.registerNavigation({
      id: "me",
      title: "我的",
      titleKey: "nav.me",
      page: "me",
      icon: User,
      group: "account",
      order: 900,
      primary: true,
      sidebar: false,
    })

    ctx.ui.registerPage(
      {
        id: "me",
        route: "me",
        title: "我的",
        titleKey: "me.title",
        requiresProvider: false,
        primary: true,
        dictionary: profileDictionary,
        children: mePageChildren,
        store,
        inject: () => ({
          hooks: {
            avatarUrl: media.urlSource,
            navRevision: ctx.navigation.state,
          },
          appVersion,
          appBuild,
          getFeatureGroups,
          hasPluginsPage: () => ctx.navigation.resolve("plugins") !== undefined,
          avatarHref: ctx.router.href({ route: "avatar" }),
          navigateToAvatar: () => {
            ctx.router.push({ route: "avatar" })
          },
          settingsHref: ctx.router.href({ route: "settings" }),
          navigateToSettings: () => {
            ctx.router.push({ route: "settings" })
          },
          pluginsHref: ctx.router.href({ route: "plugins" }),
          navigateToPlugins: () => {
            ctx.router.push({ route: "plugins" })
          },
          aboutHref: ctx.router.href({ route: "about" }),
          navigateToAbout: () => {
            ctx.router.push({ route: "about" })
          },
        }),
      },
      MePage
    )

    ctx.ui.registerPage(
      {
        id: "avatar",
        route: "avatar",
        title: "自定义头像",
        titleKey: "avatar.title",
        requiresProvider: false,
        parent: "settings",
        dictionary: profileDictionary,
        store,
        inject: () => ({
          hooks: {
            avatarUrl: media.urlSource,
          },
          saveAvatarDataUrl: (dataUrl: string) => media.save(dataUrl),
          removeAvatar: () => media.remove(),
        }),
      },
      AvatarPage
    )

    ctx.ui.registerPage(
      {
        id: "about",
        route: "about",
        title: "关于",
        titleKey: "about.title",
        requiresProvider: false,
        parent: "me",
        dictionary: profileDictionary,
        children: aboutPageChildren,
        inject: () => ({
          getAppName: (locale: PluginLocale) => (locale === "en" ? appNameEn : appNameZh),
          appVersion,
          appBuild,
          repoUrl,
          repoLabel,
          license,
          copyright,
          ...(config.iconUrl !== undefined ? { iconUrl: config.iconUrl } : {}),
          navigateToDebug: () => {
            ctx.router.push({ route: "debug" })
          },
        }),
      },
      AboutPage
    )

    ctx.ui.registerPage(
      {
        id: "debug",
        route: "debug",
        title: "Debug",
        titleKey: "debug.title",
        requiresProvider: false,
        parent: "about",
        dictionary: profileDictionary,
        children: debugPageChildren,
        inject: () => ({
          hooks: {
            location: ctx.router.current,
          },
          collectDiagnostics: (): RuntimeDiagnosticsSnapshot => {
            const screen =
              typeof window !== "undefined" && window.screen
                ? `${Math.round(window.screen.width * (window.devicePixelRatio || 1))}x${Math.round(window.screen.height * (window.devicePixelRatio || 1))}`
                : "N/A"
            const viewport =
              typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "N/A"
            const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "N/A"
            return {
              isNative: ctx.native.isNative,
              screen,
              viewport,
              userAgent,
              nativeCapabilities: ctx.native.capabilities.list(),
            }
          },
        }),
      },
      DebugPage
    )

    ctx.slots.inject("shell.sidebar.footer", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "profile-sidebar-footer",
          slot: "shell.sidebar.footer",
          order: 10,
          dictionary: profileDictionary,
          store,
          inject: () => ({
            hooks: {
              avatarUrl: media.urlSource,
            },
            appVersion,
            appBuild,
            meHref: ctx.router.href({ route: "me" }),
            navigateToMe: () => {
              ctx.router.push({ route: "me" })
            },
            aboutHref: ctx.router.href({ route: "about" }),
            navigateToAbout: () => {
              ctx.router.push({ route: "about" })
            },
          }),
        },
        SidebarProfileFooter
      )
    )

    ctx.slots.inject("settings.appearance", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "profile-appearance-avatar",
          slot: "settings.appearance",
          order: 30,
          dictionary: profileDictionary,
          inject: () => ({
            avatarHref: ctx.router.href({ route: "avatar" }),
            navigateToAvatar: () => {
              ctx.router.push({ route: "avatar" })
            },
          }),
        },
        AppearanceAvatarRow
      )
    )
  },
})

export const profilePlugin = uiProfilePlugin
export default uiProfilePlugin
