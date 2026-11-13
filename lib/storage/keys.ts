const APP_PREFIX = "orahako"

export const STORAGE_KEYS = {
  settings: `${APP_PREFIX}-settings`,
  auth: `${APP_PREFIX}-auth`,
  activation: `${APP_PREFIX}-activation`,
  cachePrefix: `${APP_PREFIX}-cache:`,
  locale: `${APP_PREFIX}-locale`,
  localeManual: `${APP_PREFIX}-locale-manual`,
  loginRateLimit: `${APP_PREFIX}-login-rate-limit`,
  lastUpdateCheck: `${APP_PREFIX}-last-update-check`,
  pwaLastUpdateCheck: `${APP_PREFIX}-pwa-last-update-check`,
  pwaDismissedUpdate: `${APP_PREFIX}-pwa-dismissed-update`,
  otaCleanup: `${APP_PREFIX}-ota-cleanup`,
  lastDismissedAnnouncementId: `${APP_PREFIX}-last-dismissed-announcement-id`,
  gradeGacha: `${APP_PREFIX}-grade-gacha`,
  schedulePatches: `${APP_PREFIX}-schedule-patches`,
  skbird: `${APP_PREFIX}-skbird`,
  secureAuthToken: `${APP_PREFIX}-auth-token`,
  secureRememberedCredentials: `${APP_PREFIX}-remember-me`,
} as const
