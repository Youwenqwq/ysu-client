import type { ComponentType, ReactNode } from "react"
import type { PluginContext } from "./runtime"

export type PluginIcon = ComponentType<{ className?: string }>

export interface PluginPageProps {
  context: PluginContext
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
  /** Defaults to true; provider-independent tools must opt out explicitly. */
  requiresProvider?: boolean
}

export type PluginNavigationGroup = string

export type PluginNavigationParams = Record<string, string | number>

interface PluginNavigationBase {
  id: string
  title: string
  titleKey?: string
  page: string
  /** Query parameters identifying a section within the target page. */
  params?: PluginNavigationParams
  icon: PluginIcon
  /** Optional plugin-owned indicator, such as an unread count. */
  badge?: ComponentType
  order?: number
  capability?: string
}

export interface PluginAppNavigationDefinition extends PluginNavigationBase {
  /** Application navigation participates in global routes and the dashboard home. */
  scope?: "app"
  group: PluginNavigationGroup
  primary?: boolean
}

export interface PluginScopedNavigationDefinition extends PluginNavigationBase {
  /** Plugin navigation replaces mobile primary tabs while this plugin is active. */
  scope: "plugin"
  group?: never
  primary?: never
}

export type PluginNavigationDefinition =
  | PluginAppNavigationDefinition
  | PluginScopedNavigationDefinition

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

export interface PluginThemeDefinition {
  id: string
  name: string
  css: string
}

export interface PluginShellProps {
  context: PluginContext
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
  /** Optional layout for Next.js content routes; the root component remains shell-owned. */
  layout?: ComponentType<{ children: ReactNode }>
}

export type PluginPageContribution = PluginPageDefinition & {
  pluginId: string
  context: PluginContext
}
export type PluginNavigationContribution = PluginNavigationDefinition & { pluginId: string }
export type PluginThemeContribution = PluginThemeDefinition & { pluginId: string }
export type PluginOverviewWidgetContribution = PluginOverviewWidgetDefinition & { pluginId: string }
export type PluginShellContribution = PluginShellDefinition & {
  pluginId: string
  context: PluginContext
}

export interface PluginUIServiceSnapshot {
  pages: readonly PluginPageContribution[]
  navigation: readonly PluginNavigationContribution[]
  themes: readonly PluginThemeContribution[]
  overviewWidgets: readonly PluginOverviewWidgetContribution[]
  shells: readonly PluginShellContribution[]
}

export interface PluginUIService {
  getSnapshot(): PluginUIServiceSnapshot
  subscribe(listener: () => void): () => void
  registerPage(page: PluginPageDefinition): () => void
  registerNavigation(item: PluginNavigationDefinition): () => void
  registerOverviewWidget(widget: PluginOverviewWidgetDefinition): () => void
  registerTheme(theme: PluginThemeDefinition): () => void
  registerShell(shell: PluginShellDefinition): () => void
}

/** Host-facing read contract for the active UI registry implementation. */
export interface PluginUIRegistryService {
  getSnapshot(): PluginUIServiceSnapshot
  subscribe(listener: () => void): () => void
  findPage(pluginId: string, pageId: string): PluginPageContribution | undefined
  findNavigation(id: string): PluginNavigationContribution | undefined
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
