/**
 * Capacitor 原生通知插件桥接。
 *
 * 对应原生插件: me.uwen.orahako.notify.OrahakoNotifyPlugin
 */
import { registerPlugin } from "@capacitor/core"

export interface OrahakoNotifyPlugin {
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
  checkExactAlarmPermission(): Promise<{ granted: boolean }>
  requestExactAlarmPermission(): Promise<{ granted: boolean }>

  // ─── Battery optimization ──────────────────────────────────────────────
  checkBatteryOptimization(): Promise<{ ignored: boolean }>
  requestIgnoreBatteryOptimization(): Promise<void>
  // TODO: 接入设置页的厂商自启动引导。
  openAutoStartSettings(): Promise<{ opened: boolean }>

  // ─── Class alarm ────────────────────────────────────────────────────────
  scheduleClassAlarms(options: { alarmsJson: string }): Promise<void>
  cancelClassAlarms(): Promise<void>

  // ─── Debug (debug builds only) ──────────────────────────────────────────
  debugLiveUpdate(options?: {
    courseName?: string
    classroom?: string
    startInMinutes?: number
    liveUpdateEnabled?: boolean
    vibrationEnabled?: boolean
  }): Promise<{ posted: boolean }>
}

export const NotifyPlugin = registerPlugin<OrahakoNotifyPlugin>("OrahakoNotify")
