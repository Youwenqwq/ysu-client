"use client"

import { useEffect, useLayoutEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { App } from "@capacitor/app"
import { isCapacitor } from "@/lib/native/platform"
import { requestBack, setNavigationBackHandler } from "@/lib/navigation/back"
import { appHistoryDepth, backFallback, installBackHistory } from "@/lib/navigation/back-history"

export function BackButtonHandler() {
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => installBackHistory(window.history), [])

  useLayoutEffect(() => {
    return setNavigationBackHandler((canGoBack) => {
      const path = pathname.replace(/\/+$/, "") || "/"
      // Never return to an authenticated page through the login page after logout.
      if (path !== "/login" && canGoBack !== false && appHistoryDepth(window.history) > 0) {
        router.back()
        return
      }
      const fallback = backFallback(path)
      if (fallback) router.replace(fallback)
      else if (isCapacitor()) void App.exitApp()
    })
  }, [pathname, router])

  useEffect(() => {
    if (!isCapacitor()) return
    let disposed = false
    let listener: { remove: () => Promise<void> } | undefined
    void App.addListener("backButton", ({ canGoBack }) => requestBack(canGoBack)).then((handle) => {
      if (disposed) void handle.remove()
      else listener = handle
    })
    return () => {
      disposed = true
      void listener?.remove()
    }
  }, [])

  return null
}
