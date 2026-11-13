/**
 * @ysu/plugin-ui/stores — host Zustand stores and storage adapters.
 */
export { useAuthStore } from "@/lib/stores/auth"
export { useSettingsStore } from "@/lib/stores/settings"
export type {
  CardStyle,
  BackgroundStyle,
  LandingPage,
  WidgetAssistantPosition,
} from "@/lib/stores/settings"
export {
  useMobileHeaderStore,
  useMobileHeaderRight,
  useMobileHeaderLayout,
} from "@/lib/stores/mobile-header"
export {
  getActiveProvider,
  setActiveProviderSchool,
  initializeActiveProvider,
  resetActiveProvider,
  logoutActiveProvider,
  reloginActiveProvider,
} from "@/providers/provider-service"
export {
  STORAGE_KEYS,
  getLocalStorageItemWithFallback,
  migrateLocalStorageKey,
  removeLocalStorageKeyPair,
} from "@/lib/storage/keys"
export { localStorageAdapter } from "@/lib/storage/local"
export { secureStorage } from "@/lib/storage/secure"
export { loadAvatarImage, saveAvatarImage, removeAvatarImage } from "@/lib/storage/avatar"
export { getSchoolConfigScope } from "@/lib/server-config"
