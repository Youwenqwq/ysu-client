/**
 * 集中管理服务器 Base URL 配置。
 *
 * 运行时可变对象 + getter 对象，支持用户自定义服务器地址。
 * 修改后需重新登录才能生效（cookie 域名变更）。
 */

import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "./storage/keys"
import {
  DEFAULT_SCHOOL_ID,
  getSchoolConfigById,
  getVisibleSchoolConfigs,
  registerSchoolConfig as registerBundledSchoolConfig,
  unregisterSchoolConfig as unregisterBundledSchoolConfig,
} from "./school-configs"
import type { SchoolConfig } from "./school-configs/types"

let currentSchoolId = DEFAULT_SCHOOL_ID
// The default school config is contributed by its provider plugin. Core boot
// must not fail when it has not registered yet.
let currentSchoolConfig: SchoolConfig | undefined = getSchoolConfigById(DEFAULT_SCHOOL_ID)

// ─── Mutable config ────────────────────────────────────────────────────── //

export const serverConfig = {
  get cerBaseUrl() {
    return serverConfig._customCerBaseUrl || currentSchoolConfig?.cas.cerBaseUrl || ""
  },
  get jwxtBaseUrl() {
    return serverConfig._customJwxtBaseUrl || currentSchoolConfig?.jwxt.jwxtBaseUrl || ""
  },
  _customCerBaseUrl: "",
  _customJwxtBaseUrl: "",
}

// ─── URL getters ───────────────────────────────────────────────────────── //

export const casUrls = {
  get cerBase() {
    return serverConfig.cerBaseUrl
  },
  get authLogin() {
    return `${serverConfig.cerBaseUrl}/authserver/login`
  },
  get authLogout() {
    return `${serverConfig.cerBaseUrl}/authserver/logout`
  },
  get authIndex() {
    return `${serverConfig.cerBaseUrl}/authserver/index.do`
  },
  get checkCaptcha() {
    return `${serverConfig.cerBaseUrl}/authserver/checkNeedCaptcha.htl`
  },
  get captcha() {
    return `${serverConfig.cerBaseUrl}/authserver/getCaptcha.htl`
  },
  get reauthType() {
    return `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/changeReAuthType.do`
  },
  get reauthSendCode() {
    return `${serverConfig.cerBaseUrl}/authserver/dynamicCode/getDynamicCodeByReauth.do`
  },
  get reauthSubmit() {
    return `${serverConfig.cerBaseUrl}/authserver/reAuthCheck/reAuthSubmit.do`
  },
  get combinedLogin() {
    return `${serverConfig.cerBaseUrl}/authserver/combinedLogin.do`
  },
  get callback() {
    return `${serverConfig.cerBaseUrl}/authserver/callback`
  },
  get defaultLoginService() {
    return `${serverConfig.cerBaseUrl}/personalInfo/personCenter/index.html`
  },
}

export const jwxtUrls = {
  get jwxtBase() {
    return serverConfig.jwxtBaseUrl
  },
  get appBase() {
    return `${serverConfig.jwxtBaseUrl}/jwapp/sys`
  },
  get portal() {
    return `${serverConfig.jwxtBaseUrl}${currentSchoolConfig?.jwxt.portalPath ?? ""}`
  },
  get appShow() {
    return `${serverConfig.jwxtBaseUrl}${currentSchoolConfig?.jwxt.appShowPath ?? ""}`
  },
}

export const mobileUrls = {
  get apiBase() {
    return `${serverConfig.jwxtBaseUrl}/jwmobile/biz/v410`
  },
  get auth() {
    return `${serverConfig.jwxtBaseUrl}/jwmobile/auth/index`
  },
  get cookieDomain() {
    return getJwxtCookieDomain()
  },
  cookiePath: "/jwmobile",
}

// ─── School config accessors ───────────────────────────────────────────── //

/**
 * Returns the active school config.
 *
 * Throws only when code actually needs the config before its provider plugin
 * has registered it; importing core modules is always safe.
 */
export function getSchoolConfig(): SchoolConfig {
  if (!currentSchoolConfig) {
    throw new Error(
      `School config "${currentSchoolId}" is not registered. Start the provider plugin first.`
    )
  }
  return currentSchoolConfig
}

/** Returns the active school config if a provider plugin has registered it. */
export function getSchoolConfigOrNull(): SchoolConfig | null {
  return currentSchoolConfig ?? null
}

export function getSchoolId(): string {
  return currentSchoolId
}

export function getSchoolConfigScope(): string {
  return JSON.stringify({
    schoolId: currentSchoolId,
    cerBaseUrl: serverConfig.cerBaseUrl,
    jwxtBaseUrl: serverConfig.jwxtBaseUrl,
  })
}

export function registerSchoolConfig(config: SchoolConfig): void {
  registerBundledSchoolConfig(config)
  if (config.id === currentSchoolId) {
    currentSchoolConfig = config
    onSchoolConfigChanged()
  }
}

/**
 * Revokes a config contributed by a provider plugin.
 *
 * Passing the config object only removes that exact registration, so a newer
 * registration for the same school is left untouched. Passing an id removes
 * whatever is registered under it.
 */
export function unregisterSchoolConfig(config: SchoolConfig | string): void {
  const schoolId = typeof config === "string" ? config : config.id
  const registered = getSchoolConfigById(schoolId)
  if (!registered) return
  if (typeof config !== "string" && registered !== config) return
  unregisterBundledSchoolConfig(schoolId)

  if (currentSchoolId !== schoolId) return
  if (typeof config !== "string" && currentSchoolConfig !== config) return
  currentSchoolConfig = undefined
  onSchoolConfigChanged()
}

export function isFeatureAvailable(feature: keyof SchoolConfig["features"]): boolean {
  return currentSchoolConfig?.features[feature] ?? false
}

export function getAvailableSchools(): Array<{
  id: string
  name: string
  nameEn: string
}> {
  return getVisibleSchoolConfigs().map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.nameEn,
  }))
}

export function setSchoolConfig(schoolId: string): boolean {
  const config = getSchoolConfigById(schoolId)
  if (!config) return false
  currentSchoolId = schoolId
  currentSchoolConfig = config
  // Reset custom URLs when switching school
  serverConfig._customCerBaseUrl = ""
  serverConfig._customJwxtBaseUrl = ""
  // Notify dependent modules to refresh their caches
  onSchoolConfigChanged()
  return true
}

// Callbacks for modules that cache school config
type SchoolConfigChangeCallback = () => void
const _onSchoolConfigChanged: SchoolConfigChangeCallback[] = []

export function onSchoolConfigChanged(callback?: SchoolConfigChangeCallback): void {
  if (callback) {
    _onSchoolConfigChanged.push(callback)
  } else {
    // Notify all registered callbacks
    for (const cb of _onSchoolConfigChanged) {
      cb()
    }
  }
}

// ─── Domain extraction ─────────────────────────────────────────────────── //

export function getCasCookieDomain(): string {
  try {
    return new URL(serverConfig.cerBaseUrl).hostname
  } catch {
    return "cer.ysu.edu.cn"
  }
}

export function getJwxtCookieDomain(): string {
  try {
    return new URL(serverConfig.jwxtBaseUrl).hostname
  } catch {
    return "jwxt.ysu.edu.cn"
  }
}

// ─── Init / reset ──────────────────────────────────────────────────────── //

export function initServerConfig(): void {
  try {
    const raw = getLocalStorageItemWithFallback(STORAGE_KEYS.settings, STORAGE_KEYS.legacySettings)
    if (!raw) return
    const parsed = JSON.parse(raw)

    // Load school ID first
    if (parsed.state?.schoolId) {
      setSchoolConfig(parsed.state.schoolId)
    }

    // Load custom URLs (these override school defaults)
    if (parsed.state?.customCerBaseUrl) {
      serverConfig._customCerBaseUrl = parsed.state.customCerBaseUrl
    }
    if (parsed.state?.customJwxtBaseUrl) {
      serverConfig._customJwxtBaseUrl = parsed.state.customJwxtBaseUrl
    }
  } catch {
    /* ignore */
  }
}

export function resetServerConfig(): void {
  serverConfig._customCerBaseUrl = ""
  serverConfig._customJwxtBaseUrl = ""
}

export function applyServerConfig(cerBaseUrl: string, jwxtBaseUrl: string): void {
  serverConfig._customCerBaseUrl = cerBaseUrl
  serverConfig._customJwxtBaseUrl = jwxtBaseUrl
}
