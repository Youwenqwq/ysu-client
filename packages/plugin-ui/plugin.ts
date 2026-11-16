/**
 * @orahako/plugin-ui/plugin — scoped plugin services plus pure navigation and
 * i18n helpers for shell/plugin UI.
 *
 * The shell bridges its scoped `PluginContext` into React with
 * `PluginServicesProvider`; components read it through `usePluginServices`.
 * This module never exposes the kernel host, a registry instance, or an
 * implementation module.
 */
export {
  PluginServicesProvider,
  usePluginServices,
  usePluginUI,
} from "./services"
export { useSemanticNavigation, type SemanticNav } from "@/plugins/official/runtime/navigation/use-semantic-navigation"
export { usePluginTranslation } from "@/plugins/official/runtime/i18n/use-plugin-translation"
export { pluginCategory, groupByPluginCategory } from "./categories"
export {
  hasPluginCapability,
  isAppNavigation,
  navigationForScope,
  resolveMobileNavigation,
  resolveActivePluginNavigation,
  resolveSemanticTarget,
  resolvePrimaryTarget,
  semanticTargetHref,
  landingPreferenceHref,
  type SemanticPageInput,
  type SemanticNavigationInput,
  type PluginNavigationLocation,
  type PluginNavigationScope,
  type SemanticNavSources,
  type SemanticNavTarget,
} from "@/plugins/official/runtime/navigation/resolvers"
