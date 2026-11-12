import type {
  PluginNavigationDefinition,
  PluginOverviewWidgetDefinition,
  PluginPageDefinition,
  PluginThemeDefinition,
  PluginSettingDefinition,
  PluginUIService,
} from "@ysu/plugin-sdk"
import type { PluginServiceFactory } from "./runtime"

export interface RegisteredPluginPage extends PluginPageDefinition {
  pluginId: string
}

export interface RegisteredPluginNavigation extends PluginNavigationDefinition {
  pluginId: string
}

export interface RegisteredPluginOverviewWidget extends PluginOverviewWidgetDefinition {
  pluginId: string
}

export interface RegisteredPluginSetting extends PluginSettingDefinition {
  pluginId: string
}

export interface RegisteredPluginTheme extends PluginThemeDefinition {
  pluginId: string
}

export interface PluginUISnapshot {
  pages: readonly RegisteredPluginPage[]
  navigation: readonly RegisteredPluginNavigation[]
  themes: readonly RegisteredPluginTheme[]
  settings: readonly RegisteredPluginSetting[]
  overviewWidgets: readonly RegisteredPluginOverviewWidget[]
}

export class PluginUIRegistry {
  private readonly pages = new Map<string, RegisteredPluginPage>()
  private readonly navigation = new Map<string, RegisteredPluginNavigation>()
  private readonly themes = new Map<string, RegisteredPluginTheme>()
  private readonly settings = new Map<string, RegisteredPluginSetting>()
  private readonly overviewWidgets = new Map<string, RegisteredPluginOverviewWidget>()
  private readonly listeners = new Set<() => void>()
  private snapshot: PluginUISnapshot = {
    pages: [],
    navigation: [],
    themes: [],
    settings: [],
    overviewWidgets: [],
  }

  createService: PluginServiceFactory = (ctx, manifest) => {
    const track = (dispose: () => void) => {
      const unregister = ctx.on("dispose", dispose)
      return () => {
        unregister()
        dispose()
      }
    }
    const service: PluginUIService = {
      registerPage: (page) =>
        track(
          this.register(this.pages, `${manifest.id}:${page.id}`, {
            ...page,
            pluginId: manifest.id,
          })
        ),
      registerNavigation: (item) =>
        track(
          this.register(this.navigation, `${manifest.id}:${item.id}`, {
            ...item,
            pluginId: manifest.id,
          })
        ),
      registerOverviewWidget: (widget) =>
        track(
          this.register(this.overviewWidgets, `${manifest.id}:${widget.id}`, {
            ...widget,
            pluginId: manifest.id,
          })
        ),
      registerSetting: (setting) =>
        track(
          this.register(this.settings, `${manifest.id}:${setting.id}`, {
            ...setting,
            pluginId: manifest.id,
          })
        ),
      registerTheme: (theme) =>
        track(
          this.register(this.themes, `${manifest.id}:${theme.id}`, {
            ...theme,
            pluginId: manifest.id,
          })
        ),
    }
    ctx.set("ui", service)
  }

  getSnapshot = (): PluginUISnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  findPage(pluginId: string, pageId: string): RegisteredPluginPage | undefined {
    return this.pages.get(`${pluginId}:${pageId}`)
  }

  private register<T>(registry: Map<string, T>, key: string, value: T): () => void {
    if (registry.has(key)) throw new Error(`Plugin UI contribution already registered: ${key}`)
    registry.set(key, value)
    this.publish()
    return () => {
      if (registry.get(key) !== value) return
      registry.delete(key)
      this.publish()
    }
  }

  private publish(): void {
    this.snapshot = {
      pages: Array.from(this.pages.values()),
      navigation: Array.from(this.navigation.values()).sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title)
      ),
      themes: Array.from(this.themes.values()),
      settings: Array.from(this.settings.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      overviewWidgets: Array.from(this.overviewWidgets.values()),
    }
    for (const listener of this.listeners) listener()
  }
}
