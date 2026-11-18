import type { Context } from "@cordisjs/core"
import type { ComponentType, ReactNode } from "react"
import type { ObservableSource } from "./observable"
import type { ChildrenSpec, DerivedComponentProps, SlotComponent, ValidInject } from "./slots"

export type PluginIcon = ComponentType<{ className?: string }>

export interface PageSpec<
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> {
  readonly id: string
  /** Stable semantic route used by shells, deep links, and PWA shortcuts. */
  readonly route?: string
  readonly title?: string
  readonly titleKey?: string
  readonly capability?: string
  /** Defaults to true; provider-independent tools must opt out explicitly. */
  readonly requiresProvider?: boolean
  readonly primary?: boolean
  /** Allows the active shell to provide an edge-to-edge mobile presentation. */
  readonly fullscreen?: boolean
  readonly parent?: string
  readonly root?: boolean
  readonly dictionary?: Dict
  readonly children?: Children
  readonly store?: Store
  readonly inject?: (ctx: Context) => ValidInject<I>
}

export interface PluginPageContribution {
  readonly id: string
  readonly pluginId: string
  readonly route?: string
  readonly title?: string
  readonly titleKey?: string
  readonly capability?: string
  readonly requiresProvider?: boolean
  readonly primary?: boolean
  readonly fullscreen?: boolean
  readonly parent?: string
  readonly root?: boolean
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
}

export type PluginNavigationGroup = string

export type PluginNavigationParams = Readonly<Record<string, string | number>>

interface PluginNavigationBase {
  readonly id: string
  readonly title?: string
  readonly titleKey?: string
  readonly page: string
  /** Query parameters identifying a section within the target page. */
  readonly params?: PluginNavigationParams
  readonly icon: PluginIcon
  /** Optional plugin-owned indicator, such as an unread count. */
  readonly badge?: ComponentType
  readonly order?: number
  readonly capability?: string
}

export interface PluginAppNavigationDefinition extends PluginNavigationBase {
  /** Application navigation participates in global routes and the dashboard home. */
  readonly scope?: "app"
  readonly group: PluginNavigationGroup
  readonly primary?: boolean
}

export interface PluginScopedNavigationDefinition extends PluginNavigationBase {
  /** Plugin navigation replaces mobile primary tabs while this plugin is active. */
  readonly scope: "plugin"
  readonly group?: never
  readonly primary?: never
}

export type PluginNavigationDefinition =
  | PluginAppNavigationDefinition
  | PluginScopedNavigationDefinition

export type PluginNavigationContribution = PluginNavigationDefinition & {
  readonly pluginId: string
}

export interface PluginThemeDefinition {
  readonly id: string
  readonly name: string
  readonly css: string
}

export type PluginThemeContribution = PluginThemeDefinition & {
  readonly pluginId: string
}

export interface ShellOwnerProps {
  readonly children?: ReactNode
  /** Select another registered shell; undefined restores the default shell. */
  selectShell(id?: string): void
}

export interface ShellSpec<
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> {
  readonly id: string
  readonly name: string
  readonly dictionary?: Dict
  readonly children?: Children
  readonly store?: Store
  readonly inject?: (ctx: Context) => ValidInject<I>
}

export interface PluginShellContribution {
  readonly id: string
  readonly pluginId: string
  readonly name: string
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
}

export interface PluginUIServiceSnapshot {
  readonly pages: readonly PluginPageContribution[]
  readonly navigation: readonly PluginNavigationContribution[]
  readonly themes: readonly PluginThemeContribution[]
  readonly shells: readonly PluginShellContribution[]
}

export interface PluginUIService {
  readonly state: ObservableSource<PluginUIServiceSnapshot>
  getSnapshot(): PluginUIServiceSnapshot
  subscribe(listener: () => void): () => void
  registerPage<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: PageSpec<Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void
  registerPage<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: PageSpec<Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    }
  ): () => void
  registerNavigation(item: PluginNavigationDefinition): () => void
  registerTheme(theme: PluginThemeDefinition): () => void
  registerShell<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: ShellSpec<Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
    >
  ): () => void
  registerShell<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: ShellSpec<Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
      >
    }
  ): () => void
}

/** Host-facing read contract for the active UI registry implementation. */
export interface PluginUIRegistryService {
  readonly state: ObservableSource<PluginUIServiceSnapshot>
  getSnapshot(): PluginUIServiceSnapshot
  subscribe(listener: () => void): () => void
  findPage(pluginId: string, pageId: string): PluginPageContribution | undefined
  findNavigation(id: string): PluginNavigationContribution | undefined
}
