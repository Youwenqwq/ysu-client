import { defineDictionary, defineStore, type StoreInstance } from "@orahako/sdk"

export const notificationsDictionary = defineDictionary({
  zh: {
    category: {
      title: "通知设置",
      description: "管理通知权限、后台轮询与各类提醒",
    },
    unavailable: {
      title: "当前学校暂不支持此功能",
      description: "该功能依赖的学校平台或客户端能力不可用",
    },
    permissions: {
      sectionTitle: "系统权限",
      exactAlarmTitle: "精确闹钟",
      exactAlarmDesc: "允许“闹钟和提醒”以确保日程提醒与实时倒计时准点触发",
      exactAlarmGranted: "已允许",
      exactAlarmNotGranted: "未允许",
      batteryTitle: "电池优化",
      batteryDesc: "关闭电池优化以确保后台通知正常工作",
      batteryIgnored: "已关闭",
      batteryNotIgnored: "未关闭",
      autoStartTitle: "自启动",
      autoStartDesc: "允许自启动以确保后台通知不被系统杀死",
      autoStartDialogTitle: "开启自启动",
      autoStartDialogContent:
        "部分系统会限制后台应用的闹钟和网络，导致提醒不准时。请在系统设置里允许本应用自启动、后台运行，并关闭电池优化。不同品牌手机的路径可能不同，通常在 设置 → 应用 → 自启动管理 中。",
      ok: "知道了",
      openSettings: "去设置",
      permissionDenied: "请在系统设置中允许通知后再开启",
      syncFailed: "通知设置同步失败，请重试",
    },
    polling: {
      sectionTitle: "通知轮询",
      enabledTitle: "后台动态通知",
      enabledDesc: "检测到已订阅的学业内容变化时推送通知",
      intervalTitle: "检查频率",
      intervalHint: "过于频繁检查会增加耗电量",
      intervalUnit: "分钟",
      contentTitle: "监听内容",
      networkErrorTitle: "网络错误提醒",
      networkErrorDesc: "通知检查失败时推送网络错误提醒",
    },
    debug: {
      title: "通知轮询诊断",
      enabled: "轮询开关",
      interval: "检查间隔",
      intervalMinutes: "{minutes} 分钟",
      networkError: "网络错误提醒",
      channels: "活动通道",
      flags: "轮询标记",
      permission: "通知权限",
      nativeState: "原生状态",
      none: "无",
      checkPermission: "检查权限",
      requestPermission: "申请权限",
      startPolling: "启动轮询",
      stopPolling: "停止轮询",
      checkNow: "立即触发检查",
      refreshInspect: "刷新状态",
      clearLog: "清空日志",
      nativeOnly: "非原生平台，已跳过",
    },
  },
  en: {
    category: {
      title: "Notification Settings",
      description: "Manage permissions, background polling, and reminders",
    },
    unavailable: {
      title: "Not available for your school",
      description: "The school platform or native capability behind this feature is unavailable.",
    },
    permissions: {
      sectionTitle: "System Permissions",
      exactAlarmTitle: "Exact Alarms",
      exactAlarmDesc: 'Allow "Alarms & reminders" for on-time schedule reminders and Live Updates',
      exactAlarmGranted: "Allowed",
      exactAlarmNotGranted: "Not allowed",
      batteryTitle: "Battery Optimization",
      batteryDesc: "Disable battery optimization to ensure background notifications work",
      batteryIgnored: "Disabled",
      batteryNotIgnored: "Enabled",
      autoStartTitle: "Auto-start",
      autoStartDesc: "Allow auto-start to prevent the system from killing background notifications",
      autoStartDialogTitle: "Enable Auto-start",
      autoStartDialogContent:
        "Some systems restrict alarms and network access for background apps. Allow auto-start and background running, and disable battery optimization for this app in Settings → Apps → Auto-start management.",
      ok: "Got it",
      openSettings: "Settings",
      permissionDenied: "Allow notifications in system settings before enabling this option.",
      syncFailed: "Could not sync notification settings. Please try again.",
    },
    polling: {
      sectionTitle: "Notification Polling",
      enabledTitle: "Academic Update Notifications",
      enabledDesc: "Get notified when subscribed academic items change",
      intervalTitle: "Check Interval",
      intervalHint: "Frequent checks may increase battery usage",
      intervalUnit: "min",
      contentTitle: "Content to Watch",
      networkErrorTitle: "Network Error Alert",
      networkErrorDesc: "Push notification when check fails due to network error",
    },
    debug: {
      title: "Notification Polling Diagnostics",
      enabled: "Polling Enabled",
      interval: "Check Interval",
      intervalMinutes: "{minutes} min",
      networkError: "Network Error Alert",
      channels: "Active Channels",
      flags: "Polling Flags",
      permission: "Notification Permission",
      nativeState: "Native State",
      none: "None",
      checkPermission: "Check Permission",
      requestPermission: "Request Permission",
      startPolling: "Start Polling",
      stopPolling: "Stop Polling",
      checkNow: "Check Now",
      refreshInspect: "Refresh Inspect",
      clearLog: "Clear Log",
      nativeOnly: "Skipped outside native shell",
    },
  },
})

export type NotificationsDictionary = typeof notificationsDictionary

export interface NotificationSettingsState {
  readonly enabled: boolean
  readonly checkInterval: number
  readonly notifyNetworkError: boolean
  readonly disabledChannels: Readonly<Record<string, boolean>>
}

export const notificationSettingsStore = defineStore({
  init: (): NotificationSettingsState => ({
    enabled: false,
    checkInterval: 60,
    notifyNetworkError: false,
    disabledChannels: {},
  }),
  persist: {
    key: "notification-settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setEnabled(ctx, enabled: boolean) {
      ctx.set((prev) => (prev.enabled === enabled ? prev : { ...prev, enabled }))
    },
    setCheckInterval(ctx, minutes: number) {
      const clamped = Math.min(1440, Math.max(15, Math.round(minutes)))
      ctx.set((prev) =>
        prev.checkInterval === clamped ? prev : { ...prev, checkInterval: clamped }
      )
    },
    setNotifyNetworkError(ctx, notifyNetworkError: boolean) {
      ctx.set((prev) =>
        prev.notifyNetworkError === notifyNetworkError ? prev : { ...prev, notifyNetworkError }
      )
    },
    setChannelEnabled(ctx, channelId: string, enabled: boolean) {
      if (!channelId) return
      ctx.set((prev) => {
        const currentlyDisabled = prev.disabledChannels[channelId] === true
        if (enabled && !currentlyDisabled) return prev
        if (!enabled && currentlyDisabled) return prev
        const nextDisabled = { ...prev.disabledChannels }
        if (enabled) {
          delete nextDisabled[channelId]
        } else {
          nextDisabled[channelId] = true
        }
        return {
          ...prev,
          disabledChannels: nextDisabled,
        }
      })
    },
    setEnabledChannels(ctx, enabledIds: readonly string[], knownChannelIds: readonly string[]) {
      const enabledSet = new Set(enabledIds)
      ctx.set((prev) => {
        const nextDisabled = { ...prev.disabledChannels }
        let changed = false
        for (const id of knownChannelIds) {
          const shouldDisable = !enabledSet.has(id)
          const wasDisabled = nextDisabled[id] === true
          if (shouldDisable && !wasDisabled) {
            nextDisabled[id] = true
            changed = true
          } else if (!shouldDisable && wasDisabled) {
            delete nextDisabled[id]
            changed = true
          }
        }
        return changed ? { ...prev, disabledChannels: nextDisabled } : prev
      })
    },
  },
})

export type NotificationSettingsStoreInstance = StoreInstance<
  NotificationSettingsState,
  typeof notificationSettingsStore.spec.actions
>
