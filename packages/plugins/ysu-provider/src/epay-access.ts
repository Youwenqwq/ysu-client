/**
 * 学费/缴费查询 —— 对外只读访问桥。
 */
import {
  ProviderError,
  ProviderErrorCode,
  wrapError,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type { YSUContext } from "./context"
import {
  EpayNotLoggedInError,
  EpayProtocolError,
  type EpayProtocol,
  type EpaySessionStatus,
} from "./protocol/epay"

export type { EpayRecord, EpaySessionStatus } from "./protocol/epay"

interface SessionIdentity {
  readonly schoolId: string | null
  readonly username: string | null
  readonly credential: string | null
}

function identityOf(snapshot: SessionSnapshot): SessionIdentity {
  return {
    schoolId: snapshot.activeSchoolId,
    username: snapshot.username,
    credential: snapshot.credential,
  }
}

function sameIdentity(left: SessionIdentity, right: SessionIdentity): boolean {
  return (
    left.schoolId === right.schoolId &&
    left.username === right.username &&
    left.credential === right.credential
  )
}

export function createEpayAccess(
  ctx: YSUContext,
  epay: Pick<EpayProtocol, "getEpayStatus">,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): () => Promise<EpaySessionStatus> {
  return async function fetchEpayPayments(): Promise<EpaySessionStatus> {
    const snapshot = ctx.session.getSnapshot()
    if (!snapshot.username || !snapshot.credential || !snapshot.isAuthenticated) {
      throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "请先登录教务", undefined, 401)
    }
    const identity = identityOf(snapshot)

    try {
      const result = await epay.getEpayStatus()
      if (!sameIdentity(identity, identityOf(ctx.session.getSnapshot()))) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "缴费账号已切换")
      }
      return result
    } catch (e) {
      const error =
        mapCASSessionError(e) ??
        (e instanceof EpayNotLoggedInError
          ? new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
          : e instanceof EpayProtocolError
            ? new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e)
            : wrapError(e))
      const current = ctx.session.getSnapshot()
      if (
        error.code === ProviderErrorCode.AUTH_SESSION_EXPIRED &&
        current.isAuthenticated &&
        sameIdentity(identity, identityOf(current))
      ) {
        ctx.session.setSessionExpired(true)
      }
      throw error
    }
  }
}
