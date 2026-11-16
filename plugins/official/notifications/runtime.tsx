"use client"

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { PluginNotificationService } from "@orahako/plugin-sdk"
import { useProvider } from "@orahako/plugin-ui/hooks"
import { usePluginServices } from "@orahako/plugin-ui/plugin"
import { observeNativeNotifications } from "@/plugins/official/runtime/native/notify"
import { clearWidgetDataFromNative } from "@/plugins/official/runtime/native/widget-bridge"

/**
 * 启动成绩/考试通知轮询与上课提醒。
 *
 * Channels are owned by the plugins that publish their settings; this runtime
 * only observes the registry snapshot and binds it to the active provider.
 */
export function NotificationRuntime({
  notifications,
}: {
  notifications: PluginNotificationService
}) {
  const provider = useProvider()
  const services = usePluginServices()
  const channels = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
    notifications.getSnapshot
  )
  const nativeNotification = provider.nativeNotification
  const grades = channels.includes("grades") && provider.capabilities.grades === true
  const exams = channels.includes("exams") && provider.capabilities.exams === true
  const schedule = channels.includes("schedule") && provider.capabilities.schedule === true
  const enabledChannels = useMemo(() => ({ grades, exams, schedule }), [grades, exams, schedule])
  const previous = useRef({ providerId: provider.id, ...enabledChannels })

  useEffect(() => {
    const before = previous.current
    if (
      before.providerId !== provider.id ||
      (before.grades && !grades) ||
      (before.exams && !exams) ||
      (before.schedule && !schedule)
    ) {
      void clearWidgetDataFromNative(services.native)
    }
    previous.current = { providerId: provider.id, grades, exams, schedule }
  }, [provider.id, grades, exams, schedule, services.native])

  useEffect(() => {
    return observeNativeNotifications({
      provider: nativeNotification,
      providerId: provider.id,
      features: enabledChannels,
    })
  }, [nativeNotification, provider.id, grades, exams, schedule, enabledChannels])

  return null
}
