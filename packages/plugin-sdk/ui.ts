import type { ComponentType } from "react"

export type PluginIcon = ComponentType<{ className?: string }>

export interface PluginPageProps {
  pluginId: string
  pageId: string
  params: URLSearchParams
  navigate(pageId: string, params?: Record<string, string | number | undefined>): void
}

export interface PluginPageDefinition {
  id: string
  title: string
  titleKey?: string
  component: ComponentType<PluginPageProps>
  parent?: string
  root?: boolean
  primary?: boolean
  capability?: string
}

export type PluginNavigationGroup = "main" | "academic" | "platform" | "fees" | "extras" | "plugins"

export interface PluginNavigationDefinition {
  id: string
  title: string
  titleKey?: string
  page: string
  icon: PluginIcon
  group: PluginNavigationGroup
  order?: number
  primary?: boolean
  capability?: string
}

export interface PluginOverviewWidgetDefinition {
  id: string
  title: string
  titleKey?: string
  description: string
  descriptionKey?: string
  icon: PluginIcon
  component: ComponentType
  region: "summary" | "content"
  defaultVisible: boolean
}

export interface PluginSettingDefinition {
  id: string
  title: string
  titleKey?: string
  page: string
  icon: PluginIcon
  order?: number
}

export interface PluginThemeDefinition {
  id: string
  name: string
  css: string
}

export interface PluginUIService {
  registerPage(page: PluginPageDefinition): () => void
  registerNavigation(item: PluginNavigationDefinition): () => void
  registerOverviewWidget(widget: PluginOverviewWidgetDefinition): () => void
  registerSetting(setting: PluginSettingDefinition): () => void
  registerTheme(theme: PluginThemeDefinition): () => void
}

export function pluginPageHref(
  pluginId: string,
  pageId = "index",
  params?: Record<string, string | number | undefined>
): string {
  const search = new URLSearchParams({ plugin: pluginId, page: pageId })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) search.set(key, String(value))
  }
  return `/dashboard/plugin/?${search.toString()}`
}
