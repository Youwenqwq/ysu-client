/**
 * Capacitor 原生通知插件桥接。
 *
 * 对应原生插件: com.youwenqwq.ysuclient.notify.YsuNotifyPlugin
 */
import { registerPlugin } from "@capacitor/core"

export interface YsuNotifyPlugin {
  // ─── CASTGC management ──────────────────────────────────────────────────
  setCastgc(options: { castgc: string }): Promise<void>
  clearCastgc(): Promise<void>

  // ─── Server config ──────────────────────────────────────────────────────
  setServerConfig(options: { configJson: string }): Promise<void>
  setProviderIdentity(options: { providerId: string; accountHash: string }): Promise<void>

  // ─── Cache read/write (JSON string) ─────────────────────────────────────
  getCachedGrades(): Promise<{ gradesJson: string }>
  setCachedGrades(options: { gradesJson: string }): Promise<void>
  getCachedExams(): Promise<{ examsJson: string }>
  setCachedExams(options: { examsJson: string }): Promise<void>

  // ─── Polling control ────────────────────────────────────────────────────
  startPolling(options: {
    intervalMinutes: number
    checkGrades: boolean
    checkExams: boolean
    notifyNetworkError: boolean
  }): Promise<void>
  stopPolling(): Promise<void>
  pausePolling(): Promise<void>
  resumePolling(): Promise<void>
  executeOnce(): Promise<void>

  // ─── Permission management ──────────────────────────────────────────────
  checkPermissions(): Promise<{ granted: boolean }>
  requestPermissions(): Promise<{ granted: boolean }>

  // ─── Battery optimization ──────────────────────────────────────────────
  checkBatteryOptimization(): Promise<{ ignored: boolean }>
  requestIgnoreBatteryOptimization(): Promise<void>

  // ─── Class alarm ────────────────────────────────────────────────────────
  scheduleClassAlarms(options: { alarmsJson: string }): Promise<void>
  cancelClassAlarms(): Promise<void>
}

export const NotifyPlugin = registerPlugin<YsuNotifyPlugin>("YsuNotify")
