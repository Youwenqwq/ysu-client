import type {
  PluginNavigationContribution,
  PluginNavigationDefinition,
  PluginPageContribution,
} from "./ui"
import type { AcademicCapabilities, AcademicProvider } from "./academic"

export interface NavigationSources {
  readonly pages: readonly PluginPageContribution[]
  readonly navigation: readonly PluginNavigationContribution[]
  readonly capabilities: AcademicCapabilities | undefined
  readonly supportedPlugins: AcademicProvider["supportedPlugins"]
  readonly fallbackHref?: string
}

export interface NavigationTarget {
  readonly pluginId: string
  readonly pageId: string
  readonly source: "page" | "navigation"
}

export interface PluginNavigationService {
  sources(): NavigationSources
  resolve(id: string): NavigationTarget | undefined
  primary(): NavigationTarget | undefined
  landing(preference: string): string
  forScope<T extends PluginNavigationDefinition>(
    scope: "app" | "plugin",
    pluginId?: string
  ): T[]
}

export type PluginNavigationScope = "app" | "plugin"

/**
 * Application navigation participates in global routing; plugin-scoped entries
 * only replace navigation while their plugin is active. An omitted scope is
 * application navigation, matching `PluginAppNavigationDefinition`.
 */
export function isAppNavigation(item: {
  scope?: PluginNavigationScope
}): boolean {
  return (item.scope ?? "app") === "app"
}
