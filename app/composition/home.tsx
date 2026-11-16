"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useSessionSnapshot } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import { usePluginHost } from "@/components/plugin-provider"

/**
 * Shell-owned landing behaviour: the application root resolves the user's
 * persisted landing preference through the active navigation service. Keeping
 * it in the composition root lets `app/page.tsx` stay a generic delegate.
 */
export function AppHome() {
  const router = useRouter()
  const { isAuthenticated, hasHydrated } = useSessionSnapshot()
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated)
  const landing = useSettingsStore((s) => s.defaultLandingPage)
  const { host } = usePluginHost()

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated) return
    if (isAuthenticated) {
      router.replace(
        host.navigation.landing(landing || host.composition.defaults.landing || "")
      )
    } else {
      router.replace("/login")
    }
  }, [
    hasHydrated,
    settingsHydrated,
    isAuthenticated,
    landing,
    host.composition,
    host.navigation,
    router,
  ])

  return null
}
