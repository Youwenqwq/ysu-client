/**
 * YSU-owned runtime context.
 *
 * Every provider instance derives its URLs and service handles from the
 * injected plugin context and the static YSU configuration. Protocol state is
 * never stored at module scope, so two provider instances can never share a
 * session.
 */
import type { MfaService, QueryService, SessionService } from "@orahako/academic-sdk"
import type {
  PluginHttpService,
  PluginI18nService,
  PluginNativeService,
  PluginStorageService,
} from "@orahako/sdk"
import { createAuthTransitionQueue, type AuthTransitionQueue } from "./auth-transition"
import { YSU_CONFIG, type YSUConfig } from "./ysu-config"

export interface YSUCasUrls {
  readonly cerBase: string
  readonly authLogin: string
  readonly authLogout: string
  readonly authIndex: string
  readonly checkCaptcha: string
  readonly captcha: string
  readonly reauthType: string
  readonly reauthSendCode: string
  readonly reauthSubmit: string
  readonly combinedLogin: string
  readonly callback: string
  readonly defaultLoginService: string
}

export interface YSUJwxtUrls {
  readonly base: string
  readonly appBase: string
  readonly portal: string
  readonly appShow: string
}

export interface YSUMobileUrls {
  readonly apiBase: string
  readonly auth: string
  readonly cookieDomain: string
  readonly cookiePath: string
}

export interface YSUUrls {
  readonly cas: YSUCasUrls
  readonly jwxt: YSUJwxtUrls
  readonly mobile: YSUMobileUrls
  readonly casCookieDomain: string
  readonly jwxtCookieDomain: string
}

function hostOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return fallback
  }
}

export function createYSUUrls(config: YSUConfig): YSUUrls {
  const cerBase = config.cas.cerBaseUrl.trim().replace(/\/+$/, "")
  const jwxtBase = config.jwxt.jwxtBaseUrl.trim().replace(/\/+$/, "")
  const jwxtCookieDomain = hostOf(jwxtBase, "jwxt.ysu.edu.cn")

  return {
    cas: {
      cerBase,
      authLogin: `${cerBase}/authserver/login`,
      authLogout: `${cerBase}/authserver/logout`,
      authIndex: `${cerBase}/authserver/index.do`,
      checkCaptcha: `${cerBase}/authserver/checkNeedCaptcha.htl`,
      captcha: `${cerBase}/authserver/getCaptcha.htl`,
      reauthType: `${cerBase}/authserver/reAuthCheck/changeReAuthType.do`,
      reauthSendCode: `${cerBase}/authserver/dynamicCode/getDynamicCodeByReauth.do`,
      reauthSubmit: `${cerBase}/authserver/reAuthCheck/reAuthSubmit.do`,
      combinedLogin: `${cerBase}/authserver/combinedLogin.do`,
      callback: `${cerBase}/authserver/callback`,
      defaultLoginService: `${cerBase}/personalInfo/personCenter/index.html`,
    },
    jwxt: {
      base: jwxtBase,
      appBase: `${jwxtBase}/jwapp/sys`,
      portal: `${jwxtBase}${config.jwxt.portalPath}`,
      appShow: `${jwxtBase}${config.jwxt.appShowPath}`,
    },
    mobile: {
      apiBase: `${jwxtBase}/jwmobile/biz/v410`,
      auth: `${jwxtBase}/jwmobile/auth/index`,
      cookieDomain: jwxtCookieDomain,
      cookiePath: "/jwmobile",
    },
    casCookieDomain: hostOf(cerBase, "cer.ysu.edu.cn"),
    jwxtCookieDomain,
  }
}

/** Services and configuration injected into one provider instance. */
export interface YSUContext {
  readonly config: YSUConfig
  readonly urls: YSUUrls
  readonly session: SessionService
  readonly http: PluginHttpService
  readonly storage: PluginStorageService
  readonly native: PluginNativeService
  readonly i18n: PluginI18nService
  readonly query: QueryService
  readonly mfa?: MfaService
  readonly transition: AuthTransitionQueue
  readonly appVersion: string
}

export interface YSUContextSource {
  readonly session: SessionService
  readonly http: PluginHttpService
  readonly storage: PluginStorageService
  readonly native: PluginNativeService
  readonly i18n: PluginI18nService
  readonly query: QueryService
  readonly mfa?: MfaService
  readonly config?: YSUConfig
  readonly transition?: AuthTransitionQueue
  readonly appVersion?: string
}

/** Binds the plugin context to the YSU configuration. */
export function createYSUContext(source: YSUContextSource): YSUContext {
  const config = source.config ?? YSU_CONFIG
  const transition = source.transition ?? createAuthTransitionQueue()
  const appVersion = source.appVersion ?? "1.0.0"

  return {
    config,
    urls: createYSUUrls(config),
    session: source.session,
    http: source.http,
    storage: source.storage,
    native: source.native,
    i18n: source.i18n,
    query: source.query,
    mfa: source.mfa,
    transition,
    appVersion,
  }
}
