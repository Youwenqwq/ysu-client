import { useSettingsStore } from "@/lib/stores/settings"
import { APP_VERSION } from "@/lib/version"
import { isCapacitor } from "@/lib/native/platform"

const STATS_ENDPOINT = "https://ysu.welain.com/api/stats"

export async function trackAppLaunch(): Promise<void> {
  const store = useSettingsStore.getState()
  if (!store.analyticsConsent) return

  const today = new Date().toISOString().split("T")[0]
  if (store.lastAnalyticsDate === today) return

  try {
    await fetch(STATS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: APP_VERSION,
        viewport: `${window.screen.width}x${window.screen.height}`,
        screen: `${Math.round(window.screen.width * window.devicePixelRatio)}x${Math.round(window.screen.height * window.devicePixelRatio)}`,
        platform: isCapacitor() ? "capacitor" : "web",
        ua: navigator.userAgent,
      }),
    })
    store.setLastAnalyticsDate(today)
  } catch {
    // Silently ignore network errors — analytics must never block startup
  }
}
