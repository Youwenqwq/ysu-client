/**
 * @orahako/plugin-ui/hooks — React hooks over host state and i18n.
 */
export { useTranslation } from "@/lib/i18n/use-translation"
export { useIsMobile } from "@/hooks/use-mobile"
export { useBackHandler, useBackLayer, BackLayer, useBackOpenState } from "@/hooks/use-back-handler"
export { useAcademicTime } from "@/hooks/use-academic-time"

// Provider data hooks
export * from "@/providers/hooks"
export { useEffectiveSchedule } from "@/providers/hooks/use-effective-schedule"
export { useEcardBalance } from "@/providers/hooks/use-ecard-balance"
export {
  useProviderQuery,
  providerQueryKey,
  providerCacheKey,
  type ProviderQueryResult,
} from "@/providers/hooks/use-provider-query"
export {
  useProvider,
  useProviderReady,
  useProviderCapabilities,
  useHasCapability,
} from "@/providers/use-provider"
export { useStudentInfo, type UseStudentInfoResult } from "@/providers/use-student-info"
export { useStoredMediaUrl, isRenderableUrl } from "@/lib/storage/media"
