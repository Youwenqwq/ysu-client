"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { isCapacitor } from "@orahako/plugin-sdk/native"
import { useSessionSnapshot } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import {
  isCurrentNotificationDestination,
  notificationDestination,
} from "@orahako/plugin-sdk"
import { usePluginServices } from "@orahako/plugin-ui/services"
import { usePluginManager } from "@orahako/plugin-ui/shell"

export function DeepLinkHandler() {
  const router = useRouter()
  const pathname = usePathname().replace(/\/$/, "")
  const { hasHydrated, isAuthenticated } = useSessionSnapshot()
  const settingsHydrated = useSettingsStore((state) => state.hasHydrated)
  const { composition } = usePluginManager()
  const navigation = usePluginServices().navigation
  const navigationRef = useRef(navigation)
  useLayoutEffect(() => {
    navigationRef.current = navigation
  }, [navigation])
  const [pendingDestination, setPendingDestination] = useState<string | null>(null)

  // Native listeners and the cold-start intent are installed/read exactly once.
  // Registry updates only refresh sourcesRef; they must not replay the launch URL.
  useEffect(() => {
    if (!isCapacitor()) return

    let disposed = false
    let receivedWarmUrl = false
    let removeListener: (() => Promise<void>) | undefined

    function handleUrl(url: string) {
      if (disposed) return false
      const scheme = composition.identity?.deepLinkScheme
      if (!scheme) return false
      const destination = notificationDestination(url, navigationRef.current, scheme)
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
          console.warn("[deep-link] Native link handling cleanup failed:", error)
        })
      }
    }
  }, [composition.identity?.deepLinkScheme])

  useEffect(() => {
    if (!pendingDestination || !hasHydrated || !settingsHydrated || !isAuthenticated) return
    // Keep the destination during login (including MFA) and the root landing redirect.
    // Navigate only after those pages finish their own default-dashboard replacement,
    // otherwise a later login callback can overwrite the notification destination.
    if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return
    if (isCurrentNotificationDestination(pathname, window.location.search, pendingDestination)) {
      setPendingDestination(null)
    } else {
      // Consume before the route commits so a quick manual navigation cannot replay this intent.
      setPendingDestination(null)
      router.replace(pendingDestination)
    }
  }, [pendingDestination, hasHydrated, settingsHydrated, isAuthenticated, pathname, router])

  return null
}
