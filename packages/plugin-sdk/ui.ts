import type { ComponentType, ReactNode } from "react"

export type PluginIcon = ComponentType<{ className?: string }>

export interface PluginPageProps {
  pluginId: string
  pageId: string
  params: URLSearchParams
  navigate(pageId: string, params?: Record<string, string | number | undefined>): void
}

export interface PluginPageDefinition {
  id: string
  /** Stable semantic route used by shells, deep links, and PWA shortcuts. */
  route?: string
  title: string
  titleKey?: string
  component: ComponentType<PluginPageProps>
  parent?: string
  root?: boolean
  primary?: boolean
  capability?: string
  /** Allows the active shell to provide an edge-to-edge mobile presentation. */
  fullscreen?: boolean
}

export type PluginNavigationGroup = string

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
  order?: number
}

export interface PluginSettingDefinition {
  id: string
  title: string
  titleKey?: string
  page: string
  icon: PluginIcon
  order?: number
  capability?: string
}

export interface PluginThemeDefinition {
  id: string
  name: string
  css: string
}

export interface PluginShellProps {
  children: ReactNode
  /** Select another registered shell; undefined restores the default shell. */
  selectShell(id?: string): void
}

/**
 * A complete application surface. The host owns boot and recovery; the shell
 * owns everything below the selected root, including authentication UI.
 */
export interface PluginShellDefinition {
  id: string
  name: string
  component: ComponentType<PluginShellProps>
}

export type PluginPageContribution = PluginPageDefinition & { pluginId: string }
export type PluginNavigationContribution = PluginNavigationDefinition & { pluginId: string }

export interface PluginUIServiceSnapshot {
  pages: readonly PluginPageContribution[]
  navigation: readonly PluginNavigationContribution[]
}

export interface PluginUIService {
  getSnapshot(): PluginUIServiceSnapshot
  subscribe(listener: () => void): () => void
  registerPage(page: PluginPageDefinition): () => void
  registerNavigation(item: PluginNavigationDefinition): () => void
  registerOverviewWidget(widget: PluginOverviewWidgetDefinition): () => void
  registerSetting(setting: PluginSettingDefinition): () => void
  registerTheme(theme: PluginThemeDefinition): () => void
  registerShell(shell: PluginShellDefinition): () => void
}

export function withAppBasePath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""
  if (!basePath || !path.startsWith("/")) return path
  return `${basePath}${path}`
}

export function pluginPageHref(
  pluginId: string,
  pageId = "index",
  params?: Record<string, string | number | undefined>
): string {
  const search = new URLSearchParams({ plugin: pluginId, page: pageId })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "plugin" || key === "page") continue
    if (value !== undefined) search.set(key, String(value))
  }
  return `/dashboard/plugin/?${search.toString()}`
}
