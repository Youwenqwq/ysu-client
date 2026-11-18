/**
 * ehall 一卡通余额 —— 对外只读访问桥。
 */
import {
  ProviderError,
  ProviderErrorCode,
  wrapError,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type { YSUContext } from "./context"
import {
  EcardNotLoggedInError,
  EcardProtocolError,
  type EcardProtocol,
  type EcardSessionStatus,
} from "./protocol/ecard"

export type { EcardBalance, EcardSessionStatus } from "./protocol/ecard"

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

export function createEcardAccess(
  ctx: YSUContext,
  ecard: Pick<EcardProtocol, "getEcardBalance">,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): () => Promise<EcardSessionStatus> {
  return async function fetchEcardBalance(): Promise<EcardSessionStatus> {
    const snapshot = ctx.session.getSnapshot()
    if (!snapshot.username || !snapshot.credential || !snapshot.isAuthenticated) {
      throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "请先登录后查询一卡通")
    }
    const identity = identityOf(snapshot)

    try {
      const status = await ecard.getEcardBalance()
      if (!sameIdentity(identity, identityOf(ctx.session.getSnapshot()))) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      return status
    } catch (e) {
      let error = mapCASSessionError(e)
      if (!error) {
        if (e instanceof EcardNotLoggedInError) {
          error = new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
        } else if (e instanceof EcardProtocolError) {
          error = new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
        } else {
          error = wrapError(e)
        }
      }
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
