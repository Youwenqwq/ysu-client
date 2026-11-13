/**
 * Explicit host capabilities available to provider plugins.
 *
 * Provider plugins must not import application internals (`@/lib`, `@/providers`,
 * `@/components`). Everything they need from the host shell is exported here so
 * official and external providers share one public surface.
 */
import type * as CapacitorCoreModule from "@capacitor/core"
import { isCapacitor } from "@/lib/native/platform"

export type { SchoolConfig } from "./provider-school"

type CapacitorCore = typeof CapacitorCoreModule

// ─── Authentication / session stores ─────────────────────────────────────── //

export { useAuthStore } from "@/lib/stores/auth"
export { useRefreshStore } from "@/lib/stores/refresh"
export { useMFAModalStore } from "@/lib/stores/mfa-modal"

// ─── School and server configuration ─────────────────────────────────────── //

export {
  applyServerConfig,
  casUrls,
  getAvailableSchools,
  getCasCookieDomain,
  getJwxtCookieDomain,
  getSchoolConfig,
  getSchoolConfigOrNull,
  getSchoolConfigScope,
  getSchoolId,
  initServerConfig,
  isFeatureAvailable,
  jwxtUrls,
  mobileUrls,
  onSchoolConfigChanged,
  registerSchoolConfig,
  resetServerConfig,
  serverConfig,
  setSchoolConfig,
  unregisterSchoolConfig,
} from "@/lib/server-config"
export type { RateLimitResult } from "@/lib/rate-limit"

// ─── Cookies and HTTP transports ─────────────────────────────────────────── //

export {
  SimpleCookieJar,
  collectCookies,
  cookieEntryFromJSON,
  fetchStateless,
  fetchWithJar,
  headerSingle,
  installCookies,
} from "@/lib/cookie"
export type { CookieEntry, HttpRequest, HttpResponse } from "@/lib/cookie"

export { aes128EcbDecrypt, aes128EcbEncrypt, base64ToBytes, bytesToBase64 } from "./crypto"

// ─── Secure storage, cache and storage keys ──────────────────────────────── //

export {
  clearRememberedCredentials,
  loadAuthToken,
  loadCASTGC,
  loadRememberedCredentials,
  removeAuthToken,
  removeCASTGC,
  saveAuthToken,
  saveCASTGC,
  saveRememberedCredentials,
  secureStorage,
} from "@/lib/storage/secure"

export {
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
  cacheGetStale,
  cacheKey,
  cacheSet,
  cleanStaleCacheVersions,
  clearAllCache,
} from "@/lib/storage/cache"

export { STORAGE_KEYS } from "@/lib/storage/keys"

// ─── Native platform ─────────────────────────────────────────────────────── //

export { isCapacitor, isTablet } from "@/lib/native/platform"
export { Geolocation } from "@capacitor/geolocation"
export { stopNotify } from "@/lib/native/notify"
export { clearWidgetDataFromNative } from "@/lib/native/widget-bridge"

// ─── Text, notifications, rate limiting ──────────────────────────────────── //

export { getText } from "@/lib/i18n/get-text"
export { toast } from "sonner"
export {
  checkRateLimit,
  clearLoginAttempts,
  formatRetryDuration,
  rateLimitMessage,
  recordLoginAttempt,
} from "@/lib/rate-limit"

// ─── Version information ─────────────────────────────────────────────────── //

export {
  APP_BUILD,
  APP_COPYRIGHT,
  APP_LICENSE,
  APP_OPEN_SOURCE,
  APP_PEOPLE,
  APP_REPO,
  APP_VERSION,
} from "@/lib/version"

// ─── Native lifecycle helpers ────────────────────────────────────────────── //

let capacitorCore: CapacitorCore | null = null

/** Loads Capacitor core lazily; resolves null on web/tests. */
export async function getCapacitorCore(): Promise<CapacitorCore | null> {
  if (capacitorCore) return capacitorCore
  try {
    capacitorCore = await import("@capacitor/core")
    return capacitorCore
  } catch {
    return null
  }
}

/**
 * Removes OTA bundles and download caches that are no longer in use.
 * Safe to call on web: only native platforms are touched.
 *
 * Dynamic imports are intentional: these native modules are not available on
 * every platform and must not join the initial host bundle.
 */
export async function cleanOtaArtifacts(): Promise<void> {
  if (!isCapacitor()) return

  // Clean stale OTA bundles (autoDeletePrevious does not run in manual mode).
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater")
    const [{ bundles }, current] = await Promise.all([
      CapacitorUpdater.list(),
      CapacitorUpdater.current(),
    ])
    for (const bundle of bundles) {
      if (bundle.id === "builtin" || bundle.id === current.bundle.id) continue
      await CapacitorUpdater.delete({ id: bundle.id }).catch(() => {})
    }
  } catch {
    // Ignore unavailable updater on non-native builds.
  }

  // Clean OTA download cache.
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem")
    await Filesystem.rmdir({
      path: "capgo_downloads",
      directory: Directory.Cache,
      recursive: true,
    })
  } catch {
    // Directory missing or not removable.
  }

  // Clean downloaded APKs.
  try {
    const { clearApkCache } = await import("@/lib/updater")
    await clearApkCache()
  } catch {
    // Ignore unavailable updater.
  }
}
