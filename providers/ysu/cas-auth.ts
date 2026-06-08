/**
 * CAS authentication wrapper for YSU Provider.
 *
 * Keeps CAS protocol details in lib/cas.ts while exposing a provider-native
 * auth service shape and mapping CAS exceptions to ProviderError.
 */
import {
  prepareLogin as _prepareLogin,
  checkCaptchaNeeded as _checkCaptchaNeeded,
  loginStep1 as _loginStep1,
  requestMFACode as _requestMFACode,
  submitMFACode as _submitMFACode,
  isAuthenticated as _isAuthenticated,
  initiateWechatMFA as _initiateWechatMFA,
  pollWechatQR as _pollWechatQR,
  completeWechatMFA as _completeWechatMFA,
  resetCAS,
  CASCredential,
  getJar as getCasJar,
  type MFAChallenge,
  type WechatMFAContext,
  CASError,
  NeedCaptchaError,
  IPBlockedError,
  LoginFailedError,
  MFARequiredError,
  MFAFailedError,
  CASProtocolError,
  NotAuthenticatedError,
} from "./protocol/cas";
import { checkRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { useAuthStore } from "@/lib/stores/auth";
import { casUrls } from "@/lib/server-config";
import { ProviderError, ProviderErrorCode, wrapError } from "../errors";
import type { WechatQrPollResult } from "../types";
import { getYSUMfaMethods, isYSUMfaMethod } from "./types";

export interface LoginStep1Result {
  authenticated: boolean;
  needsMfa: boolean;
  username: string;
  credential?: string;
}

export type { MFAChallenge, WechatMFAContext };

function mapCASError(e: unknown): ProviderError {
  if (e instanceof NeedCaptchaError) {
    return new ProviderError(ProviderErrorCode.AUTH_CAPTCHA_REQUIRED, e.message, e, 403);
  }
  if (e instanceof IPBlockedError) {
    return new ProviderError(ProviderErrorCode.RATE_LIMITED, e.message, e, 429);
  }
  if (e instanceof LoginFailedError) {
    return new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, e.message, e, 401);
  }
  if (e instanceof MFARequiredError) {
    return new ProviderError(
      ProviderErrorCode.AUTH_MFA_REQUIRED,
      e.message,
      e,
      403,
      { methods: [...getYSUMfaMethods()] },
    );
  }
  if (e instanceof MFAFailedError) {
    return new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, e.message, e, 401);
  }
  if (e instanceof NotAuthenticatedError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401);
  }
  if (e instanceof CASProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  if (e instanceof CASError) {
    return new ProviderError(ProviderErrorCode.BACKEND_BUSINESS_ERROR, e.message, e, 500);
  }
  return wrapError(e);
}

export function getCaptchaUrl(): string {
  return casUrls.captcha;
}

export async function prepareLogin(): Promise<void> {
  try {
    await _prepareLogin();
  } catch (e) {
    throw mapCASError(e);
  }
}

export function resetLoginSession(): void {
  resetCAS();
}

export async function checkCaptchaNeeded(username: string): Promise<boolean> {
  try {
    return await _checkCaptchaNeeded(username);
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function loginStep1(
  credential: { username: string; password: string; captcha?: string },
  skipRateLimit = false,
): Promise<LoginStep1Result> {
  if (!skipRateLimit) {
    const limit = checkRateLimit();
    if (!limit.allowed) {
      throw new ProviderError(
        ProviderErrorCode.RATE_LIMITED,
        `Rate limited: retry after ${Math.ceil(limit.retryAfterMs / 1000)}s`,
        undefined,
        429,
      );
    }
    recordLoginAttempt();
  }

  try {
    const result = await _loginStep1(credential.username, credential.password, {
      captcha: credential.captcha,
    });
    const credStr =
      result.authenticated || result.needsMfa
        ? (await CASCredential.fromJar(getCasJar())).toJSON()
        : undefined;
    return {
      authenticated: result.authenticated,
      needsMfa: result.needsMfa,
      username: result.username,
      credential: credStr,
    };
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function requestMFACode(
  username: string,
  method: string,
): Promise<MFAChallenge> {
  if (!isYSUMfaMethod(method)) {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Unsupported YSU MFA method: ${method}`,
      undefined,
      501,
      { methods: [...getYSUMfaMethods()] },
    );
  }

  try {
    return await _requestMFACode(username, method);
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function submitMFACode(
  challenge: MFAChallenge,
  code: string,
): Promise<string> {
  try {
    const credential = await _submitMFACode(challenge, code);
    return credential.toJSON();
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function initiateWechatMFA(): Promise<WechatMFAContext> {
  try {
    return await _initiateWechatMFA();
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function pollWechatQR(
  uuid: string,
  lastErrcode?: number,
): Promise<WechatQrPollResult> {
  try {
    return await _pollWechatQR(uuid, lastErrcode);
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function completeWechatMFA(
  code: string,
  state: string,
): Promise<string> {
  try {
    const credential = await _completeWechatMFA(code, state);
    return credential.toJSON();
  } catch (e) {
    throw mapCASError(e);
  }
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    return await _isAuthenticated();
  } catch (e) {
    throw mapCASError(e);
  }
}

export function saveCredential(credential: string, username?: string): void {
  useAuthStore.getState().setCredential(credential, username);
}
