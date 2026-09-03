/**
 * 学费未缴自动检查：App 打开时按频率查询缴费状态，
 * 若存在未缴项目则触发通知（toast + 可选系统通知）。
 *
 * 优先走 SSO（复用教务会话拉取全部记录）；若不可用则回退无密码查询。
 * 仅读取状态，不发起任何支付。
 */

import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { EpayAccessError, fetchEpayPayments } from "@/providers/ysu/epay-access"
import { toRecordStatus } from "@/providers/ysu/protocol/epay"
import { fetchEpayBills } from "./client"
import { isUnpaid } from "./types"

/** 距离上次检查的最小间隔（毫秒）：3 小时 */
const MIN_INTERVAL_MS = 3 * 3600 * 1000

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

  const username = useAuthStore.getState().username
  if (!username) return null

  const account = settings.epayAccountSettings[username]
  const lastCheckedAt = account?.lastCheckedAt ?? 0
  if (Date.now() - lastCheckedAt < MIN_INTERVAL_MS) return null
  const name = account?.name.trim() ?? ""

  try {
    // 优先 SSO：教务会话拉取全部记录
    try {
      const status = await fetchEpayPayments()
      const unpaid = status.records.filter((r) => toRecordStatus(r) === "unpaid")
      useSettingsStore.getState().setEpayLastCheckedAt(username, Date.now())
      return {
        hasUnpaid: unpaid.length > 0,
        count: unpaid.length,
        total: unpaid.reduce((s, r) => s + r.amountN, 0),
      }
    } catch (e) {
      // SSO 不可用（未登录教务）→ 回退无密码查询（需姓名）
      if (!name) return null
      if (!(e instanceof EpayAccessError)) throw e
      const bills = await fetchEpayBills(username, name)
      const unpaid = bills.unpaid.filter((b) => isUnpaid(b.payStatus))
      useSettingsStore.getState().setEpayLastCheckedAt(username, Date.now())
      return {
        hasUnpaid: unpaid.length > 0,
        count: unpaid.length,
        total: unpaid.reduce((s, b) => s + b.amount, 0),
      }
    }
  } catch {
    // 网络/解析错误静默
    return null
  }
}
