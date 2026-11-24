/**
 * CAS / JWXT / jwmobile 会话生命周期。
 */
import type { CookieJar } from "@orahako/academic-sdk"
import type { YSUContext } from "./context"
import { CASCredential, type CASProtocol } from "./protocol/cas"
import type { EcardProtocol } from "./protocol/ecard"
import type { EpayProtocol } from "./protocol/epay"
import { MobileSession, type JWMobileProtocol } from "./protocol/jwmobile"
import { JWXTSession, type JWXTProtocol } from "./protocol/jwxt"
import type { LdxtProtocol } from "./protocol/ldxt"
import type { ScxtProtocol } from "./protocol/scxt"
import type { XgxtProtocol } from "./protocol/xgxt"
import {
  YSU_SECURE_KEY_CAS_TGC,
  YSU_SESSION_ARTIFACT_JWXT,
  YSU_SESSION_ARTIFACT_MOBILE,
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
  resetDerivedSessions(): void
  persistJWXTSession(): Promise<void>
  persistMobileSession(): Promise<void>
  getCasJar(): CookieJar
  getJwxtJar(): CookieJar
  getMobileJar(): CookieJar
}

async function stopNativeIntegrations(ctx: YSUContext): Promise<void> {
  const { capabilities } = ctx.native
  await capabilities.invoke("academic.polling@1", "stop").catch(() => {})
  await capabilities.invoke("widgets.generic@1", "clear").catch(() => {})
}

export function createSessionLifecycle(
  ctx: YSUContext,
  protocols: YSUSessionProtocols
): YSUSessionLifecycle {
  const { withAuthTransition } = ctx.transition
  const { cas, jwxt, mobile, ldxt, scxt, xgxt, epay, ecard } = protocols

  async function initializeSession(): Promise<void> {
    epay.resetEpay()
    ecard.resetEcard()

    const snapshot = ctx.session.getSnapshot()
    if (snapshot.credential) {
      try {
        const casCredential = CASCredential.fromJSON(snapshot.credential, ctx.urls.casCookieDomain)
        await cas.restoreCredential(casCredential)
        await cas.saveCASTGC().catch(() => {})
      } catch {
        // Ignore malformed persisted CAS credential; login can replace it.
      }
    }

    const jwxtSession = ctx.session.getArtifact(YSU_SESSION_ARTIFACT_JWXT, ctx.config.id)
    if (jwxtSession) {
      try {
        const session = JWXTSession.fromJSON(jwxtSession)
        if (!session.isEmpty()) {
          await jwxt.restoreSession(session)
        }
      } catch {
        // Ignore malformed persisted JWXT session artifact.
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
        // Ignore malformed persisted mobile session artifact.
      }
    }
  }

  async function persistJWXTSession(): Promise<void> {
    const session = await JWXTSession.fromJar(jwxt.getJar(), ctx.urls.jwxtCookieDomain)
    if (!session.isEmpty()) {
      ctx.session.setArtifact(YSU_SESSION_ARTIFACT_JWXT, session.toJSON(), ctx.config.id)
    }
  }

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

  async function resetSession(): Promise<void> {
    await withAuthTransition(async () => {
      try {
        await cas.logoutCAS()
      } catch {
        // Ignore remote CAS logout failure during local session reset.
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
