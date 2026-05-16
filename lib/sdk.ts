/**
 * SDK 初始化层 —— CAS / JWXT / jwmobile 模块状态管理。
 *
 * 从 auth-store 加载/保存凭据,提供状态恢复与重置。
 */
import {
  CASCredential,
  restoreCredential,
  resetCAS,
  restoreCASCookies,
  getJar as getCasJar,
} from "./cas";
import {
  JWXTSession,
  restoreSession as restoreJWXTSession,
  resetJWXT,
  getJar as getJwxtJar,
} from "./jwxt";
import {
  MobileSession,
  restoreSession as restoreMobileSession,
  resetMobileAuth,
  getJar as getMobileJar,
} from "./jwmobile";
import { useAuthStore } from "./auth-store";

/** 从 auth-store 恢复 CAS 凭据、JWXT 会话和 mobile 会话到各自的 jar。 */
export async function initSDK(): Promise<void> {
  // Restore CASTGC to CapacitorHttp system cookie store (for native platforms)
  await restoreCASCookies();

  const { credential, jwxtSession, mobileSession } = useAuthStore.getState();
  if (credential) {
    const casCredential = CASCredential.fromJSON(credential);
    await restoreCredential(casCredential);
  }
  if (jwxtSession) {
    try {
      const session = JWXTSession.fromJSON(jwxtSession);
      if (!session.isEmpty()) {
        await restoreJWXTSession(session);
      }
    } catch {
      // 无效的 JWXT session,忽略
    }
  }
  if (mobileSession) {
    try {
      const session = MobileSession.fromJSON(mobileSession);
      if (!session.isEmpty()) {
        await restoreMobileSession(session);
      }
    } catch {
      // 无效的 mobile session,忽略
    }
  }
}

/** 将当前 JWXT jar 中的会话持久化到 auth-store。 */
export async function persistJWXTSession(): Promise<void> {
  const session = await JWXTSession.fromJar(getJwxtJar());
  if (!session.isEmpty()) {
    useAuthStore.getState().setJWXTSession(session.toJSON());
  }
}

/** 将当前 mobile jar 中的会话持久化到 auth-store。 */
export async function persistMobileSession(): Promise<void> {
  const session = await MobileSession.fromJar(getMobileJar());
  if (!session.isEmpty()) {
    useAuthStore.getState().setMobileSession(session.toJSON());
  }
}

/** 重置所有 SDK 状态(登出时调用)。 */
export function resetSDK(): void {
  resetCAS();
  resetJWXT();
  resetMobileAuth();
}

/** 获取 CAS cookie jar(调试用)。 */
export { getCasJar };
/** 获取 JWXT cookie jar(调试用)。 */
export { getJwxtJar };
/** 获取 mobile cookie jar(调试用)。 */
export { getMobileJar };
