/**
 * Composes one YSU provider instance from the injected plugin context.
 *
 * The returned object owns every protocol state and service handle used by the
 * provider; nothing is shared through module scope.
 */
import type { ProviderDiagnostics } from "@orahako/academic-sdk"
import { createCasAuth, type CasAuthApi } from "./cas-auth"
import { createYSUContext, type YSUContext, type YSUContextSource } from "./context"
import { createYsuDiagnostics } from "./diagnostics"
import { createEcardAccess } from "./ecard-access"
import { createEmapFetcher, type EmapFetcher } from "./emap-fetcher"
import { createEpayAccess } from "./epay-access"
import { createLdxtFetcher, type LdxtFetcher } from "./ldxt-fetcher"
import { YSUMobileAdapter } from "./mobile-adapter"
import { createYsuNativePolling, type YsuNativePolling } from "./native-polling"
import { createCAS, type CASProtocol } from "./protocol/cas"
import { createECARD, type EcardProtocol, type EcardSessionStatus } from "./protocol/ecard"
import { createEPAY, type EpayProtocol, type EpaySessionStatus } from "./protocol/epay"
import { createJWMobile, type JWMobileProtocol } from "./protocol/jwmobile"
import { createJWXT, type JWXTProtocol } from "./protocol/jwxt"
import { createLDXT, type LdxtProtocol } from "./protocol/ldxt"
import { createSCXT, type ScxtProtocol } from "./protocol/scxt"
import { createXGXT, type XgxtProtocol } from "./protocol/xgxt"
import { createRelogin, type ReloginApi } from "./relogin"
import { createSessionLifecycle, type YSUSessionLifecycle } from "./session"
import { createScxtFetcher, type ScxtFetcher } from "./scxt-fetcher"
import { createXgxtFetcher, type XgxtFetcher } from "./xgxt-fetcher"

export interface YSUProviderRuntime {
  readonly ctx: YSUContext
  readonly cas: CASProtocol
  readonly jwxt: JWXTProtocol
  readonly mobile: JWMobileProtocol
  readonly ldxt: LdxtProtocol
  readonly scxt: ScxtProtocol
  readonly xgxt: XgxtProtocol
  readonly epay: EpayProtocol
  readonly ecard: EcardProtocol
  readonly auth: CasAuthApi
  readonly lifecycle: YSUSessionLifecycle
  readonly emap: EmapFetcher
  readonly ldxtFetcher: LdxtFetcher
  readonly scxtFetcher: ScxtFetcher
  readonly xgxtFetcher: XgxtFetcher
  readonly diagnostics: ProviderDiagnostics
  readonly nativePolling: YsuNativePolling
  readonly mobileAdapter: YSUMobileAdapter
  fetchEcardBalance(): Promise<EcardSessionStatus>
  fetchEpayPayments(): Promise<EpaySessionStatus>
  readonly relogin: ReloginApi
}

export function createYSUProviderRuntime(source: YSUContextSource): YSUProviderRuntime {
  const ctx = createYSUContext(source)

  const cas = createCAS(ctx)
  const jwxt = createJWXT(ctx, cas)
  const mobile = createJWMobile(ctx, cas)
  const ldxt = createLDXT(ctx, cas)
  const scxt = createSCXT(ctx, cas)
  const xgxt = createXGXT(ctx, cas)
  const epay = createEPAY(ctx, cas)
  const ecard = createECARD(ctx, cas)

  const auth = createCasAuth(ctx, cas)
  const lifecycle = createSessionLifecycle(ctx, {
    cas,
    jwxt,
    mobile,
    ldxt,
    scxt,
    xgxt,
    epay,
    ecard,
  })

  const emap = createEmapFetcher(jwxt, lifecycle.persistJWXTSession, auth.mapCASSessionError)
  const ldxtFetcher = createLdxtFetcher(ldxt, auth.mapCASSessionError)
  const scxtFetcher = createScxtFetcher(scxt, auth.mapCASSessionError)
  const xgxtFetcher = createXgxtFetcher(xgxt, auth.mapCASSessionError)

  return {
    ctx,
    cas,
    jwxt,
    mobile,
    ldxt,
    scxt,
    xgxt,
    epay,
    ecard,
    auth,
    lifecycle,
    emap,
    ldxtFetcher,
    scxtFetcher,
    xgxtFetcher,
    diagnostics: createYsuDiagnostics(cas, jwxt, mobile),
    nativePolling: createYsuNativePolling(ctx),
    mobileAdapter: new YSUMobileAdapter(mobile, auth.mapCASSessionError),
    fetchEcardBalance: createEcardAccess(ctx, ecard, auth.mapCASSessionError),
    fetchEpayPayments: createEpayAccess(ctx, epay, auth.mapCASSessionError),
    relogin: createRelogin(ctx, cas, auth, lifecycle),
  }
}
