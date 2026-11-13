/**
 * @ysu/plugin-ui/plugin — plugin-host-facing hooks and navigation resolvers.
 *
 * Pure resolvers plus UI-store hooks; none of these load the plugin provider
 * context (that lives in `@ysu/plugin-ui/shell`), so plugins can import this
 * submodule freely.
 */
export { usePluginUI } from "@/lib/plugins/use-plugin-ui"
export { usePluginTranslation } from "@/lib/plugins/use-plugin-translation"
export { usePluginRouteStore, type ActivePluginRoute } from "@/lib/stores/plugin-route"
export {
  hasPluginCapability,
  resolveSemanticTarget,
  resolvePrimaryTarget,
  semanticTargetHref,
  landingPreferenceHref,
  CORE_DASHBOARD_FALLBACK_HREF,
  type SemanticPageInput,
  type SemanticNavigationInput,
  type SemanticNavSources,
  type SemanticNavTarget,
} from "@/lib/plugins/navigation"
