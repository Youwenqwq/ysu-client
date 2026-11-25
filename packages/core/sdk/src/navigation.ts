import type { ObservableSource } from "./observable"
import type {
  PluginNavigationContribution,
  PluginNavigationDefinition,
  PluginPageContribution,
} from "./ui"

export interface NavigationFilterContext {
  readonly pluginId: string
  readonly capability?: string
  readonly requiresProvider?: boolean
}

/**
 * Predicate registered by domain runtimes (such as academic capability/allowlist
 * policy) to filter pages and navigation items without coupling generic
 * navigation to school or provider concepts.
 */
export type NavigationFilter = (entry: NavigationFilterContext) => boolean

export interface NavigationSources {
  readonly pages: readonly PluginPageContribution[]
  readonly navigation: readonly PluginNavigationContribution[]
  readonly fallbackHref?: string
}

export interface NavigationTarget {
  readonly pluginId: string
  readonly pageId: string
  readonly source: "page" | "navigation"
}

export type PluginNavigationScope = "app" | "plugin"

export interface PluginNavigationService {
  readonly state: ObservableSource<number>
  sources(): NavigationSources
  resolve(id: string): NavigationTarget | undefined
  primary(): NavigationTarget | undefined
  landing(preference: string): string
  /**
   * Whether a concrete page passes the same provider/capability filters used
   * for semantic routes. Explicit `?plugin=…&page=…` deep links MUST check this
   * instead of looking the page up directly.
   */
  available(pluginId: string, pageId: string): boolean
  forScope<T extends PluginNavigationDefinition = PluginNavigationContribution>(
    scope: PluginNavigationScope,
    pluginId?: string
  ): readonly T[]
  registerFilter(filter: NavigationFilter): () => void
}

/**
 * Application navigation participates in global routing; plugin-scoped entries
 * only replace navigation while their plugin is active. An omitted scope is
 * application navigation, matching `PluginAppNavigationDefinition`.
 */
export function isAppNavigation(item: { readonly scope?: PluginNavigationScope }): boolean {
  return (item.scope ?? "app") === "app"
}
