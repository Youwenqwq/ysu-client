"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { isCapacitor } from "@/lib/native/platform"
import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"

function notificationDestination(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "ysuclient:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    switch (parsed.host) {
      case "grades":
        return "/dashboard/grades"
      case "exams":
        return "/dashboard/exams"
      case "schedule":
        return "/dashboard/schedule"
      case "settings":
        return "/dashboard/me/settings"
      default:
        return null
    }
  } catch {
    return null
  }
}

export function DeepLinkHandler() {
  const router = useRouter()
  const pathname = usePathname().replace(/\/$/, "")
  const hasHydrated = useAuthStore((state) => state.hasHydrated)
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const settingsHydrated = useSettingsStore((state) => state.hasHydrated)
  const [pendingDestination, setPendingDestination] = useState<string | null>(null)

  useEffect(() => {
    if (!isCapacitor()) return

    let disposed = false
    let receivedWarmUrl = false
    let removeListener: (() => Promise<void>) | undefined

    function handleUrl(url: string) {
      if (disposed) return false
      const destination = notificationDestination(url)
      if (!destination) return false
      setPendingDestination(destination)
      return true
    }

    void import("@capacitor/app")
      .then(async ({ App }) => {
        if (disposed) return
        // Register first so a warm intent cannot be lost while getLaunchUrl is pending.
        const listener = await App.addListener("appUrlOpen", ({ url }) => {
          if (handleUrl(url)) receivedWarmUrl = true
        })
        if (disposed) {
          await listener.remove()
          return
        }
        removeListener = () => listener.remove()
        const launch = await App.getLaunchUrl()
        // A newer notification click takes precedence over the initial activity intent.
        if (!receivedWarmUrl && launch?.url) handleUrl(launch.url)
      })
      .catch((error: unknown) => {
        console.warn("[deep-link] Native link handling failed:", error)
      })

    return () => {
      disposed = true
      if (removeListener) {
        void removeListener().catch((error: unknown) => {
          console.warn("[deep-link] Native link cleanup failed:", error)
        })
      }
    }
  }, [])

  useEffect(() => {
    if (!pendingDestination || !hasHydrated || !settingsHydrated || !isAuthenticated) return
    // Keep the destination during login (including MFA) and the root landing redirect.
    // Navigate only after those pages finish their own default-dashboard replacement,
    // otherwise a later login callback can overwrite the notification destination.
    if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return
    if (pathname === pendingDestination) {
      setPendingDestination(null)
    } else {
      router.replace(pendingDestination)
    }
  }, [pendingDestination, hasHydrated, settingsHydrated, isAuthenticated, pathname, router])

  return null
}
