/**
 * 学费/缴费查询 —— 对外只读访问桥。
 *
 * 复用教务 CAS 会话（authorize）免密建立 elpay 会话，拉取全部付款记录。
 * 错误遵循公共 ProviderError 契约。
 *
 * 放在 providers/ysu 下以复用协议层的 jar/authorize，避免 extras 反向依赖。
 */
import {
  getEpayStatus,
  EpayNotLoggedInError,
  EpayProtocolError,
  type EpaySessionStatus,
} from "./protocol/epay"
import { useAuthStore } from "@/lib/stores/auth"
import { getSchoolConfigScope } from "@/lib/server-config"
import { ProviderError, ProviderErrorCode, wrapError } from "../errors"
import { mapCASSessionError } from "./cas-auth"

export type { EpayRecord, EpaySessionStatus } from "./protocol/epay"


/**
 * 登录态下查询缴费状态（历史记录与官方待缴清单）。
 * 未登录/会话失效通过 ProviderError.code 区分。
 */
export async function fetchEpayPayments(): Promise<EpaySessionStatus> {
  const { username, credential, isAuthenticated } = useAuthStore.getState()
  if (!username || !credential || !isAuthenticated) {
    throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "请先登录教务", undefined, 401)
  }
  const scope = getSchoolConfigScope()
  try {
    const result = await getEpayStatus()
    const current = useAuthStore.getState()
    if (
      current.username !== username ||
      !current.isAuthenticated ||
      current.credential !== credential ||
      getSchoolConfigScope() !== scope
    ) {
      throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "缴费账号已切换")
    }
    return result
  } catch (e) {
    const error = mapCASSessionError(e) ?? (
      e instanceof EpayNotLoggedInError
        ? new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
        : e instanceof EpayProtocolError
          ? new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e)
          : wrapError(e)
    )
    const current = useAuthStore.getState()
    if (
      error.code === ProviderErrorCode.AUTH_SESSION_EXPIRED &&
      current.isAuthenticated &&
      current.username === username &&
      current.credential === credential &&
      getSchoolConfigScope() === scope
    ) {
      current.setSessionExpired(true)
    }
    throw error
  }
}

