/**
 * 学费/缴费查询 —— 对外只读访问桥。
 *
 * 复用教务 CAS 会话（authorize）免密建立 elpay 会话，拉取全部付款记录。
 * 需要用户已登录教务（SSO）；未登录或授权失败时抛 EpayAccessError。
 *
 * 放在 providers/ysu 下以复用协议层的 jar/authorize，避免 extras 反向依赖。
 */
import {
  getEpayStatus,
  resetEpay,
  EpayNotLoggedInError,
  type EpaySessionStatus,
} from "./protocol/epay"
import { isAuthenticated, NotAuthenticatedError } from "./protocol/cas"

export type { EpayRecord, EpaySessionStatus } from "./protocol/epay"

export class EpayAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EpayAccessError"
  }
}

/**
 * 登录态下查询缴费状态（全部记录 + 最近一笔）。
 * 未登录/会话失效抛 EpayAccessError。
 */
export async function fetchEpayPayments(): Promise<EpaySessionStatus> {
  if (!(await isAuthenticated())) {
    throw new EpayAccessError("未登录教务，无法查询缴费")
  }
  try {
    return await getEpayStatus()
  } catch (e) {
    if (e instanceof EpayNotLoggedInError || e instanceof NotAuthenticatedError) {
      throw new EpayAccessError("缴费会话已过期，请重新登录")
    }
    throw e
  }
}

/** 登出时清除 elpay 会话。 */
export function clearEpaySession(): void {
  resetEpay()
}
