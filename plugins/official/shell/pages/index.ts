import type { PluginPageDefinition } from "@orahako/plugin-sdk"
import { AboutPage } from "./about"
import { AvatarSettingsPage } from "./avatar"
import { BackgroundSettingsPage } from "./background"
import { DebugPage } from "./debug"
import { LoginPage } from "./login"
import { MePage } from "./me"
import { PluginsPage } from "./plugins"
import { SettingsPage } from "./settings"
import { PluginSettingsPage } from "./settings/plugins"
import { WidgetSettingsPage } from "./settings/widgets"

/**
 * Official shell pages. Every page declares a stable semantic route so static
 * Next.js entries can carry only `<SemanticPage route="…" />`; another
 * composition can replace any implementation without touching those entries.
 */
export const officialShellPages: readonly PluginPageDefinition[] = [
  {
    id: "login",
    route: "login",
    title: "登录",
    titleKey: "app.login",
    component: LoginPage,
    requiresProvider: false,
  },
  {
    id: "me",
    route: "me",
    title: "我的",
    titleKey: "app.me",
    component: MePage,
    requiresProvider: true,
  },
  {
    id: "settings",
    route: "settings",
    title: "设置",
    titleKey: "settings.title",
    component: SettingsPage,
    requiresProvider: true,
  },
  {
    id: "settings-plugins",
    route: "settings-plugins",
    title: "插件设置",
    titleKey: "settings.pluginSettings",
    component: PluginSettingsPage,
    requiresProvider: true,
  },
  {
    id: "settings-widgets",
    route: "settings-widgets",
    title: "桌面小组件",
    titleKey: "desktopWidgets.title",
    component: WidgetSettingsPage,
    requiresProvider: true,
  },
  {
    id: "plugins",
    route: "plugins",
    title: "插件",
    titleKey: "plugins.title",
    component: PluginsPage,
    requiresProvider: true,
  },
  {
    id: "about",
    route: "about",
    title: "关于",
    titleKey: "about.title",
    component: AboutPage,
    requiresProvider: true,
  },
  {
    id: "avatar",
    route: "avatar",
    title: "自定义头像",
    titleKey: "app.avatarSettings",
    component: AvatarSettingsPage,
    requiresProvider: true,
  },
  {
    id: "background",
    route: "background",
    title: "背景图设置",
    titleKey: "app.backgroundSettings",
    component: BackgroundSettingsPage,
    requiresProvider: true,
  },
  {
    id: "debug",
    route: "debug",
    title: "Debug",
    titleKey: "debug.title",
    component: DebugPage,
    requiresProvider: true,
  },
]
