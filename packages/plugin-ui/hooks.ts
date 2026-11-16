/**
 * @orahako/plugin-ui/hooks — React hooks over host state and i18n.
 */
export { useTranslation } from "@/plugins/official/runtime/i18n/use-translation"
export { useIsMobile } from "@/hooks/use-mobile"
export { useBackHandler, useBackLayer, BackLayer, useBackOpenState } from "@/hooks/use-back-handler"
export { useAcademicTime } from "@/hooks/use-academic-time"

// Provider runtime React adapters
export { useProviderContext, type ProviderContextValue } from "./provider"
export {
  useProvider,
  useProviderReady,
  useProviderCapabilities,
  useSupportedPlugins,
  useHasCapability,
} from "./use-provider"
export { useSessionSnapshot } from "./use-session"
export { useProviderAccount } from "./use-provider-account"
export { useLongPress } from "./use-long-press"
export {
  useProviderQuery,
  providerQueryKey,
  providerCacheKey,
  type ProviderQueryResult,
} from "./use-provider-query"
export { useEcardBalance } from "./use-ecard-balance"
export { useStoredMediaUrl, isRenderableUrl } from "@/plugins/official/shell/media/media"
