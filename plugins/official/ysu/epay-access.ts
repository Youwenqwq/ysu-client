/**
 * 学费/缴费查询 —— 对外只读访问桥。
 *
 * 复用教务 CAS 会话（authorize）免密建立 elpay 会话，拉取全部付款记录。
 * 错误遵循公共 ProviderError 契约。
 *
 * 学校协议与会话留在 provider，界面和启动提醒仅消费此访问桥。
 */
import {
  EpayNotLoggedInError,
  EpayProtocolError,
  type EpayProtocol,
  type EpaySessionStatus,
} from "./protocol/epay"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"
import type { SessionSnapshot } from "@orahako/plugin-sdk"
import type { YSUContext } from "./context"

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
  epay: EpayProtocol,
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
