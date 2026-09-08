/**
 * 学费未缴自动检查：App 打开时按频率查询缴费状态，
 * 若存在未缴项目则返回结果，供启动流程显示应用内提醒。
 *
 * 仅走 SSO：复用教务会话；未登录教务时不查询。
 * 仅读取状态，不发起任何支付。
 */

import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { fetchEpayPayments } from "@/providers/ysu/epay-access"

/** 距离上次检查的最小间隔（毫秒）：3 小时 */
const MIN_INTERVAL_MS = 3 * 3600 * 1000

const checkingAccounts = new Map<string, string | null>()

export interface EpayCheckResult {
  /** 是否有未缴项目 */
  hasUnpaid: boolean
  /** 未缴笔数 */
  count: number
  /** 未缴合计（元） */
  total: number
}

/**
 * 触发一次自动检查（幂等：频率受限）。返回查询结果或 null（未满足条件/失败）。
 */
export async function runEpayAutoCheck(): Promise<EpayCheckResult | null> {
  const settings = useSettingsStore.getState()
  if (!settings.epayNotifyEnabled) return null

  const { username, credential } = useAuthStore.getState()
  if (!username || checkingAccounts.get(username) === credential) return null

  const account = settings.epayAccountSettings[username]
  const lastCheckedAt = account?.lastCheckedAt ?? 0
  if (Date.now() - lastCheckedAt < MIN_INTERVAL_MS) return null
  checkingAccounts.set(username, credential)

  try {
    const status = await fetchEpayPayments()
    const currentAuth = useAuthStore.getState()
    if (
      currentAuth.username !== username ||
      currentAuth.credential !== credential ||
      !useSettingsStore.getState().epayNotifyEnabled
    ) return null
    // 待缴仅来自 index(我的待付款)，不从 allPay 历史推断。
    const unpaid = status.unpaid
    useSettingsStore.getState().setEpayLastCheckedAt(username, Date.now())
    return {
      hasUnpaid: unpaid.length > 0,
      count: unpaid.length,
      total: unpaid.reduce((sum, record) => sum + Math.round(record.amountN * 100), 0) / 100,
    }
  } catch {
    // 网络/解析错误静默
    return null
  } finally {
    if (checkingAccounts.get(username) === credential) checkingAccounts.delete(username)
  }
}
