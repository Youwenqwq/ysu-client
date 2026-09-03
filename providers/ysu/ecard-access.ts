/**
 * ehall 一卡通余额 —— 对外只读访问桥。
 *
 * 复用教务 CAS 会话（authorize）免密建立 ehall 会话，查询一卡通余额。
 * 放在 providers/ysu 下以复用协议层的 jar/authorize。
 */
import { getEcardBalance, resetEcard, type EcardBalance, type EcardSessionStatus } from "./protocol/ecard"
import { isAuthenticated } from "./protocol/cas"

export type { EcardBalance, EcardSessionStatus } from "./protocol/ecard"

export class EcardAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EcardAccessError"
  }
}

/** 登录态下查询一卡通余额。未登录/会话失效抛 EcardAccessError。 */
export async function fetchEcardBalance(): Promise<EcardSessionStatus> {
  if (!(await isAuthenticated())) {
    throw new EcardAccessError("未登录教务，无法查询一卡通")
  }
  try {
    return await getEcardBalance()
  } catch (e) {
    if (e instanceof Error && e.name === "EcardNotLoggedInError") {
      throw new EcardAccessError("一卡通会话已过期，请重新登录")
    }
    throw e
  }
}

/** 登出时清除 ehall 会话。 */
export function clearEcardSession(): void {
  resetEcard()
}