"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { landingPreferenceHref } from "@/lib/plugins/navigation"
import { useSemanticNavigation } from "@/lib/navigation/use-semantic-navigation"

export default function HomePage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated)
  const landing = useSettingsStore((s) => s.defaultLandingPage)
  const nav = useSemanticNavigation()

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated) return
    if (isAuthenticated) {
      router.replace(landingPreferenceHref(landing, nav.sources))
    } else {
      router.replace("/login")
    }
  }, [hasHydrated, settingsHydrated, isAuthenticated, landing, nav, router])

  return null
}
