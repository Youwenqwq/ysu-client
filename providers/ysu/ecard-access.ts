/**
 * ehall 一卡通余额 —— 对外只读访问桥。
 *
 * 复用教务 CAS 会话（authorize）免密建立 ehall 会话，查询一卡通余额。
 * 放在 providers/ysu 下以复用协议层的 jar/authorize。
 */
import { getEcardBalance, EcardNotLoggedInError, EcardProtocolError, type EcardSessionStatus } from "./protocol/ecard"
import { mapCASSessionError } from "./cas-auth"
import { ProviderError, ProviderErrorCode, wrapError } from "../errors"
import { useAuthStore } from "@/lib/stores/auth"
import { getSchoolConfigScope } from "@/lib/server-config"

export type { EcardBalance, EcardSessionStatus } from "./protocol/ecard"


/** 登录态下查询一卡通余额，复用 ProviderError 会话错误契约。 */
export async function fetchEcardBalance(): Promise<EcardSessionStatus> {
  const { username, credential, isAuthenticated } = useAuthStore.getState()
  const scope = getSchoolConfigScope()
  if (!username || !credential || !isAuthenticated) {
    throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "请先登录后查询一卡通")
  }
  try {
    const status = await getEcardBalance()
    const current = useAuthStore.getState()
    if (
      current.username !== username ||
      current.credential !== credential ||
      !current.isAuthenticated ||
      getSchoolConfigScope() !== scope
    ) {
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
