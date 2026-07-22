const APP_PREFIX = "academic-client";
const LEGACY_PREFIX = "ysu";

export const STORAGE_KEYS = {
  settings: `${APP_PREFIX}-settings`,
  legacySettings: `${LEGACY_PREFIX}-settings`,
  auth: `${APP_PREFIX}-auth`,
  legacyAuth: `${LEGACY_PREFIX}-auth`,
  cachePrefix: `${APP_PREFIX}-cache:`,
  legacyCachePrefix: `${LEGACY_PREFIX}-cache:`,
  locale: `${APP_PREFIX}-locale`,
  legacyLocale: `${LEGACY_PREFIX}-locale`,
  localeManual: `${APP_PREFIX}-locale-manual`,
  legacyLocaleManual: `${LEGACY_PREFIX}-locale-manual`,
  loginRateLimit: `${APP_PREFIX}-login-rate-limit`,
  legacyLoginRateLimit: `${LEGACY_PREFIX}-login-rate-limit`,
  lastUpdateCheck: `${APP_PREFIX}-last-update-check`,
  legacyLastUpdateCheck: `${LEGACY_PREFIX}-last-update-check`,
  otaCleanup: `${APP_PREFIX}-ota-cleanup`,
  legacyOtaCleanup: `${LEGACY_PREFIX}-ota-cleanup`,
  lastDismissedAnnouncementId: `${APP_PREFIX}-last-dismissed-announcement-id`,
  legacyLastDismissedAnnouncementId: `${LEGACY_PREFIX}-last-dismissed-announcement-id`,
  gradeGacha: `${APP_PREFIX}-grade-gacha`,
  secureAuthToken: `${APP_PREFIX}-auth-token`,
  legacySecureAuthToken: `${LEGACY_PREFIX}-castgc`,
  secureRememberedCredentials: `${APP_PREFIX}-remember-me`,
  legacySecureRememberedCredentials: `${LEGACY_PREFIX}-remember-me`,
} as const;

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function migrateLocalStorageKey(currentKey: string, legacyKey: string): void {
  if (!canUseLocalStorage()) return;
  try {
    const current = localStorage.getItem(currentKey);
    const legacy = localStorage.getItem(legacyKey);
    if (current === null && legacy !== null) {
      localStorage.setItem(currentKey, legacy);
    }
    if (legacy !== null) {
      localStorage.removeItem(legacyKey);
    }
  } catch {
    // ignore storage errors
  }
}

export function getLocalStorageItemWithFallback(
  currentKey: string,
  legacyKey: string,
): string | null {
  if (!canUseLocalStorage()) return null;
  try {
    const current = localStorage.getItem(currentKey);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(currentKey, legacy);
      localStorage.removeItem(legacyKey);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function removeLocalStorageKeyPair(currentKey: string, legacyKey: string): void {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.removeItem(currentKey);
    localStorage.removeItem(legacyKey);
  } catch {
    // ignore storage errors
  }
}
