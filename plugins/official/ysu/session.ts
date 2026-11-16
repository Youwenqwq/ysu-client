/**
 * SDK 初始化层 —— CAS / JWXT / jwmobile 会话生命周期。
 *
 * 所有状态都属于当前 provider 实例；凭据和会话 artifact 通过注入的
 * PluginSessionService 读写，不触碰宿主 store 内部结构。
 */
import type { CookieJar } from "@orahako/plugin-sdk"
import type { YSUContext } from "./context"
import { CASCredential, type CASProtocol } from "./protocol/cas"
import { JWXTSession, type JWXTProtocol } from "./protocol/jwxt"
import { MobileSession, type JWMobileProtocol } from "./protocol/jwmobile"
import type { LdxtProtocol } from "./protocol/ldxt"
import type { ScxtProtocol } from "./protocol/scxt"
import type { XgxtProtocol } from "./protocol/xgxt"
import type { EpayProtocol } from "./protocol/epay"
import type { EcardProtocol } from "./protocol/ecard"
import { withAuthTransition } from "./auth-transition"
import {
  YSU_SESSION_ARTIFACT_JWXT,
  YSU_SESSION_ARTIFACT_MOBILE,
  YSU_SECURE_KEY_CAS_TGC,
} from "./ysu-config"

export interface YSUSessionProtocols {
  readonly cas: CASProtocol
  readonly jwxt: JWXTProtocol
  readonly mobile: JWMobileProtocol
  readonly ldxt: LdxtProtocol
  readonly scxt: ScxtProtocol
  readonly xgxt: XgxtProtocol
  readonly epay: EpayProtocol
  readonly ecard: EcardProtocol
}

export interface YSUSessionLifecycle {
  initializeSession(): Promise<void>
  warmupSession(): Promise<void>
  resetSession(): Promise<void>
  /** Clears in-memory protocol sessions without touching persisted credentials. */
  resetDerivedSessions(): void
  persistJWXTSession(): Promise<void>
  persistMobileSession(): Promise<void>
  getCasJar(): CookieJar
  getJwxtJar(): CookieJar
  getMobileJar(): CookieJar
}

/**
 * Replaces the provider's own notification polling and home-screen widget data.
 * Native capabilities are optional; failures stay silent on Web and on builds
 * that omit the capability.
 */
async function stopNativeIntegrations(ctx: YSUContext): Promise<void> {
  const { capabilities } = ctx.native
  await capabilities.invoke("academic.polling@1", "stop").catch(() => {})
  await capabilities.invoke("widgets.generic@1", "clear").catch(() => {})
}

export function createSessionLifecycle(
  ctx: YSUContext,
  protocols: YSUSessionProtocols
): YSUSessionLifecycle {
  const { cas, jwxt, mobile, ldxt, scxt, xgxt, epay, ecard } = protocols

  /** 从 session artifacts 恢复 CAS 凭据、JWXT 会话和 mobile 会话到各自 jar。 */
  async function initializeSession(): Promise<void> {
    // Fee sessions are derived from CAS and must never survive credential restoration.
    epay.resetEpay()
    ecard.resetEcard()

    const snapshot = ctx.session.getSnapshot()
    if (snapshot.credential) {
      const casCredential = CASCredential.fromJSON(
        snapshot.credential,
        ctx.urls.casCookieDomain
      )
      await cas.restoreCredential(casCredential)
    }

    const jwxtSession = ctx.session.getArtifact(YSU_SESSION_ARTIFACT_JWXT, ctx.config.id)
    if (jwxtSession) {
      try {
        const session = JWXTSession.fromJSON(jwxtSession)
        if (!session.isEmpty()) {
          await jwxt.restoreSession(session)
        }
      } catch {
        // 无效的 JWXT session,忽略
      }
    }

    const mobileSession = ctx.session.getArtifact(YSU_SESSION_ARTIFACT_MOBILE, ctx.config.id)
    if (mobileSession) {
      try {
        const session = MobileSession.fromJSON(mobileSession)
        if (!session.isEmpty()) {
          await mobile.restoreSession(session)
        }
      } catch {
        // 无效的 mobile session,忽略
      }
    }
  }

  /** 将当前 JWXT jar 中的会话持久化到 session artifacts。 */
  async function persistJWXTSession(): Promise<void> {
    const session = await JWXTSession.fromJar(jwxt.getJar(), ctx.urls.jwxtCookieDomain)
    if (!session.isEmpty()) {
      ctx.session.setArtifact(YSU_SESSION_ARTIFACT_JWXT, session.toJSON(), ctx.config.id)
    }
  }

  /** 将当前 mobile jar 中的会话持久化到 session artifacts。 */
  async function persistMobileSession(): Promise<void> {
    const session = await MobileSession.fromJar(mobile.getJar(), ctx.urls.jwxtCookieDomain)
    if (!session.isEmpty()) {
      ctx.session.setArtifact(YSU_SESSION_ARTIFACT_MOBILE, session.toJSON(), ctx.config.id)
    }
  }

  async function warmupSession(): Promise<void> {
    if (ctx.config.features.hasMobile) {
      mobile.ensureMobileAuthorized(true).catch(() => {})
    }
  }

  function resetDerivedSessions(): void {
    cas.resetCAS()
    jwxt.resetJWXT()
    ldxt.resetLdxt()
    scxt.resetScxt()
    xgxt.resetXgxt()
    epay.resetEpay()
    ecard.resetEcard()
    mobile.resetMobileAuth()
  }

  /** 重置所有 SDK 状态(登出时调用)。 */
  async function resetSession(): Promise<void> {
    await withAuthTransition(async () => {
      try {
        await cas.logoutCAS()
      } catch {
        // 忽略 CAS 服务端登出失败
      } finally {
        resetDerivedSessions()
        ctx.query.clearPersistent()
        ctx.query.invalidate()
        await stopNativeIntegrations(ctx)
        await ctx.storage.secure.removeItem(YSU_SECURE_KEY_CAS_TGC).catch(() => {})
      }
    })
  }

  return {
    initializeSession,
    warmupSession,
    resetSession,
    resetDerivedSessions,
    persistJWXTSession,
    persistMobileSession,
    getCasJar: () => cas.getJar(),
    getJwxtJar: () => jwxt.getJar(),
    getMobileJar: () => mobile.getJar(),
  }
}
