/**
 * CAS authentication wrapper for YSU Provider.
 *
 * Keeps CAS protocol details in ./protocol/cas.ts while exposing a
 * provider-native auth service shape and mapping CAS exceptions to ProviderError.
 */
import { checkRateLimit, recordLoginAttempt } from "@/plugins/official/runtime/login-rate-limit"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"
import type { WechatQrPollResult } from "@orahako/plugin-sdk"
import type { YSUContext } from "./context"
import {
  CASError,
  CASCredential,
  CASProtocolError,
  IPBlockedError,
  LoginFailedError,
  MFAFailedError,
  MFARequiredError,
  NeedCaptchaError,
  NotAuthenticatedError,
  type CASProtocol,
  type MFAChallenge,
  type WechatMFAContext,
} from "./protocol/cas"
import { withAuthTransition } from "./auth-transition"
import { getYSUMfaMethods, isYSUMfaMethod } from "./types"

export interface LoginStep1Result {
  authenticated: boolean
  needsMfa: boolean
  username: string
  credential?: string
}

export type { MFAChallenge, WechatMFAContext }

export interface CasAuthApi {
  mapCASSessionError(error: unknown): ProviderError | undefined
  getCaptchaUrl(): string
  prepareLogin(): Promise<void>
  resetLoginSession(): Promise<void>
  checkCaptchaNeeded(username: string): Promise<boolean>
  loginStep1(
    credential: { username: string; password: string; captcha?: string },
    skipRateLimit?: boolean
  ): Promise<LoginStep1Result>
  requestMFACode(username: string, method: string): Promise<MFAChallenge>
  submitMFACode(challenge: MFAChallenge, code: string): Promise<string>
  initiateWechatMFA(): Promise<WechatMFAContext>
  pollWechatQR(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<WechatQrPollResult>
  completeWechatMFA(code: string, state: string): Promise<string>
  isAuthenticated(): Promise<boolean>
  saveCredential(credential: string, username?: string): void
}


export function createCasAuth(ctx: YSUContext, cas: CASProtocol): CasAuthApi {
  function mapCASSessionError(e: unknown): ProviderError | undefined {
    if (!(e instanceof NotAuthenticatedError)) return undefined
    return new ProviderError(
      ProviderErrorCode.AUTH_SESSION_EXPIRED,
      ctx.i18n.t("app.sessionExpired"),
      e,
      401
    )
  }

  function mapCASError(e: unknown): ProviderError {
    const sessionError = mapCASSessionError(e)
    if (sessionError) return sessionError

    if (e instanceof NeedCaptchaError) {
      return new ProviderError(ProviderErrorCode.AUTH_CAPTCHA_REQUIRED, e.message, e, 403)
    }
    if (e instanceof IPBlockedError) {
      return new ProviderError(ProviderErrorCode.RATE_LIMITED, e.message, e, 429)
    }
    if (e instanceof LoginFailedError) {
      return new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, e.message, e, 401)
    }
    if (e instanceof MFARequiredError) {
      return new ProviderError(ProviderErrorCode.AUTH_MFA_REQUIRED, e.message, e, 403, {
        methods: [...getYSUMfaMethods()],
      })
    }
    if (e instanceof MFAFailedError) {
      return new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, e.message, e, 401)
    }
    if (e instanceof CASProtocolError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
    }
    if (e instanceof CASError) {
      return new ProviderError(ProviderErrorCode.BACKEND_BUSINESS_ERROR, e.message, e, 500)
    }
    return wrapError(e)
  }

  function getCaptchaUrl(): string {
    return ctx.urls.cas.captcha
  }

  async function prepareLogin(): Promise<void> {
    try {
      await cas.prepareLogin()
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function resetLoginSession(): Promise<void> {
    await withAuthTransition(async () => {
      cas.resetCAS()
    })
  }

  async function checkCaptchaNeeded(username: string): Promise<boolean> {
    try {
      return await cas.checkCaptchaNeeded(username)
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function loginStep1(
    credential: { username: string; password: string; captcha?: string },
    skipRateLimit = false
  ): Promise<LoginStep1Result> {
    if (!skipRateLimit) {
      const limit = checkRateLimit()
      if (!limit.allowed) {
        throw new ProviderError(
          ProviderErrorCode.RATE_LIMITED,
          `Rate limited: retry after ${Math.ceil(limit.retryAfterMs / 1000)}s`,
          undefined,
          429
        )
      }
      recordLoginAttempt()
    }

    try {
      const result = await cas.loginStep1(credential.username, credential.password, {
        captcha: credential.captcha,
      })
      const credStr =
        result.authenticated || result.needsMfa
          ? (await CASCredential.fromJar(cas.getJar(), ctx.urls.casCookieDomain)).toJSON()
          : undefined
      return {
        authenticated: result.authenticated,
        needsMfa: result.needsMfa,
        username: result.username,
        credential: credStr,
      }
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function requestMFACode(username: string, method: string): Promise<MFAChallenge> {
    if (!isYSUMfaMethod(method)) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Unsupported YSU MFA method: ${method}`,
        undefined,
        501,
        { methods: [...getYSUMfaMethods()] }
      )
    }

    try {
      return await cas.requestMFACode(username, method)
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function submitMFACode(challenge: MFAChallenge, code: string): Promise<string> {
    try {
      const credential = await cas.submitMFACode(challenge, code)
      return credential.toJSON()
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function initiateWechatMFA(): Promise<WechatMFAContext> {
    try {
      return await cas.initiateWechatMFA()
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function pollWechatQR(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<WechatQrPollResult> {
    try {
      return await cas.pollWechatQR(uuid, lastErrcode, signal)
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function completeWechatMFA(code: string, state: string): Promise<string> {
    try {
      const credential = await cas.completeWechatMFA(code, state)
      return credential.toJSON()
    } catch (e) {
      throw mapCASError(e)
    }
  }

  async function isAuthenticated(): Promise<boolean> {
    try {
      return await cas.isAuthenticated()
    } catch (e) {
      throw mapCASError(e)
    }
  }

  function saveCredential(credential: string, username?: string): void {
    ctx.session.setCredential({
      schoolId: ctx.config.id,
      credential,
      username: username ?? null,
    })
  }

  return {
    mapCASSessionError,
    getCaptchaUrl,
    prepareLogin,
    resetLoginSession,
    checkCaptchaNeeded,
    loginStep1,
    requestMFACode,
    submitMFACode,
    initiateWechatMFA,
    pollWechatQR,
    completeWechatMFA,
    isAuthenticated,
    saveCredential,
  }
}
