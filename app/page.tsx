"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { pluginPageHref } from "@ysu/plugin-sdk"

export default function HomePage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated)
  const landing = useSettingsStore((s) => s.defaultLandingPage)

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated) return
    if (isAuthenticated) {
      router.replace(
        landing === "schedule"
          ? pluginPageHref("ysu.schedule", "index")
          : pluginPageHref("ysu.overview", "index")
      )
    } else {
      router.replace("/login")
    }
  }, [hasHydrated, settingsHydrated, isAuthenticated, landing, router])

  return null
}
