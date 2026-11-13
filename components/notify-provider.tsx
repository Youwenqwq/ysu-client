"use client"

import { useEffect, useRef } from "react"
import { observeNativeNotifications } from "@/lib/native/notify"
import { clearWidgetDataFromNative } from "@/lib/native/widget-bridge"
import { usePluginStates } from "@/components/plugin-provider"
import { useProvider } from "@/providers/use-provider"

/**
 * 启动成绩/考试通知轮询。
 * 在 SDK 初始化完成后挂载，仅 Capacitor 平台生效。
 */
export function NotifyProvider() {
  const provider = useProvider()
  const nativeNotification = provider.nativeNotification
  const states = usePluginStates()
  const active = (id: string) =>
    states.some(
      (state) =>
        state.manifest.id === id && (state.status === "active" || state.status === "starting")
    )
  const grades = active("orahako.grades")
  const exams = active("orahako.exams")
  const schedule = active("orahako.schedule")
  const previous = useRef({ providerId: provider.id, grades, exams, schedule })

  useEffect(() => {
    const before = previous.current
    if (
      before.providerId !== provider.id ||
      (before.grades && !grades) ||
      (before.exams && !exams) ||
      (before.schedule && !schedule)
    ) {
      void clearWidgetDataFromNative()
    }
    previous.current = { providerId: provider.id, grades, exams, schedule }
  }, [provider.id, grades, exams, schedule])

  useEffect(() => {
    return observeNativeNotifications(nativeNotification, provider.id, {
      grades,
      exams,
      schedule,
    })
  }, [nativeNotification, provider.id, grades, exams, schedule])

  return null
}
