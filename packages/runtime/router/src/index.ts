export {
  PluginRouter,
  ROUTER_RUNTIME_PLUGIN_ID,
  routerRuntimePlugin,
  type BrowserHistoryLike,
  type BrowserWindowLike,
  type HardwareBackAdapter,
  type HardwareBackListenerHandle,
  type PluginRouterOptions,
  type RouterRuntimeConfig,
} from "./router"
export {
  NAVIGATION_RUNTIME_PLUGIN_ID,
  NavigationRuntimeService,
  navigationRuntimePlugin,
  type NavigationRuntimeConfig,
  type NavigationUISource,
} from "./navigation"
export {
  isPrimaryNavigationLocation,
  landingPreferenceHref,
  navigationForScope,
  resolveActivePluginNavigation,
  resolveMobileNavigation,
  resolvePrimaryTarget,
  resolveSemanticTarget,
  semanticTargetHref,
  type NavigationLocationParams,
  type PluginNavigationLocation,
  type SemanticNavigationInput,
  type SemanticNavSources,
  type SemanticNavTarget,
  type SemanticPageInput,
} from "./resolvers"
