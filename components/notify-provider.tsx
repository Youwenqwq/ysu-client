"use client"

import { useEffect } from "react"
import { observeNativeNotifications } from "@/lib/native/notify"
import { useProvider } from "@/providers/use-provider"

/**
 * 启动成绩/考试通知轮询。
 * 在 SDK 初始化完成后挂载，仅 Capacitor 平台生效。
 */
export function NotifyProvider() {
  const provider = useProvider()
  const nativeNotification = provider.nativeNotification

  useEffect(() => {
    return observeNativeNotifications(nativeNotification, provider.id)
  }, [nativeNotification, provider.id])

  return null
}
