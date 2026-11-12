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
  logoutCAS,
  getJar as getCasJar,
} from "./protocol/cas"
import {
  JWXTSession,
  restoreSession as restoreJWXTSession,
  resetJWXT,
  getJar as getJwxtJar,
} from "./protocol/jwxt"
import {
  MobileSession,
  restoreSession as restoreMobileSession,
  resetMobileAuth,
  getJar as getMobileJar,
} from "./protocol/jwmobile"
import { resetLdxt } from "./protocol/ldxt"
import { resetScxt } from "./protocol/scxt"
import { resetXgxt } from "./protocol/xgxt"
import { resetEpay } from "./protocol/epay"
import { resetEcard } from "./protocol/ecard"
import {
  STORAGE_KEYS,
  cleanOtaArtifacts,
  cleanStaleCacheVersions,
  clearAllCache,
  clearWidgetDataFromNative,
  initServerConfig,
  removeCASTGC,
  stopNotify,
  useAuthStore,
  useRefreshStore,
} from "@ysu/plugin-sdk/host"
import { withAuthTransition } from "./auth-transition"

/** 从 auth-store 恢复 CAS 凭据、JWXT 会话和 mobile 会话到各自的 jar。 */
export async function initializeSession(): Promise<void> {
  // Fee sessions are derived from CAS and must never survive credential restoration.
  resetEpay()
  resetEcard()
  // 从 settings-store 初始化自定义服务器地址
  initServerConfig()
  // 清理因 credential 轮换产生的孤立缓存
  cleanStaleCacheVersions()
  // OTA 更新后清理旧版本和下载缓存，仅当 updater 设置了标志位时才执行
  if (
    localStorage.getItem(STORAGE_KEYS.otaCleanup) ||
    localStorage.getItem(STORAGE_KEYS.legacyOtaCleanup)
  ) {
    localStorage.removeItem(STORAGE_KEYS.otaCleanup)
    localStorage.removeItem(STORAGE_KEYS.legacyOtaCleanup)
    cleanOtaArtifacts()
  }
  // Restore CASTGC to CapacitorHttp system cookie store (for native platforms)
  await restoreCASCookies()

  const { credential, jwxtSession, mobileSession } = useAuthStore.getState()
  if (credential) {
    const casCredential = CASCredential.fromJSON(credential)
    await restoreCredential(casCredential)
  }
  if (jwxtSession) {
    try {
      const session = JWXTSession.fromJSON(jwxtSession)
      if (!session.isEmpty()) {
        await restoreJWXTSession(session)
      }
    } catch {
      // 无效的 JWXT session,忽略
    }
  }
  if (mobileSession) {
    try {
      const session = MobileSession.fromJSON(mobileSession)
      if (!session.isEmpty()) {
        await restoreMobileSession(session)
      }
    } catch {
      // 无效的 mobile session,忽略
    }
  }
}

/** 将当前 JWXT jar 中的会话持久化到 auth-store。 */
export async function persistJWXTSession(): Promise<void> {
  const session = await JWXTSession.fromJar(getJwxtJar())
  if (!session.isEmpty()) {
    useAuthStore.getState().setJWXTSession(session.toJSON())
  }
}

/** 将当前 mobile jar 中的会话持久化到 auth-store。 */
export async function persistMobileSession(): Promise<void> {
  const session = await MobileSession.fromJar(getMobileJar())
  if (!session.isEmpty()) {
    useAuthStore.getState().setMobileSession(session.toJSON())
  }
}

/** 重置所有 SDK 状态(登出时调用)。 */
export async function resetSession(): Promise<void> {
  await withAuthTransition(async () => {
    try {
      await logoutCAS()
    } catch {
      // 忽略 CAS 服务端登出失败
    } finally {
      resetCAS()
      resetJWXT()
      resetLdxt()
      resetScxt()
      resetXgxt()
      resetEpay()
      resetEcard()
      resetMobileAuth()
      clearAllCache()
      useRefreshStore.setState({ count: 0, stale: 0 })
      // Stop all notification services on logout
      stopNotify()
      // Clear account-specific data kept by home-screen widgets.
      void clearWidgetDataFromNative()
      await removeCASTGC().catch(() => {})
    }
  })
}

/** 获取 CAS cookie jar(调试用)。 */
export { getCasJar }
/** 获取 JWXT cookie jar(调试用)。 */
export { getJwxtJar }
/** 获取 mobile cookie jar(调试用)。 */
export { getMobileJar }
