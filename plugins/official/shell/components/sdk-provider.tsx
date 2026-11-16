"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useProviderContext, useSessionSnapshot } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import { useUpdateStore } from "@/plugins/official/shell/stores/update"
import { useTranslation } from "@/plugins/official/runtime/i18n/use-translation"
import { invokeNativeCapability, isCapacitor } from "@orahako/plugin-sdk/native"
import { blurActiveElement } from "@orahako/plugin-ui/components"

import { AnalyticsPrompt } from "./analytics-prompt"
import { APP_VERSION } from "@orahako/plugin-ui/platform"
import { useAnnouncementStore } from "@/plugins/official/shell/stores/announcement"

import { AnnouncementDialog } from "./announcement-dialog"

import { usePluginServices } from "@orahako/plugin-ui/plugin"
import type {
  AcademicPluginContext,
  PluginAnalyticsService,
  PluginAnnouncementService,
  PluginUpdateService,
} from "@orahako/plugin-sdk"

type OfficialServices = AcademicPluginContext & {
  analytics: PluginAnalyticsService
  announcement: PluginAnnouncementService
  updater: PluginUpdateService
}

export function SDKProvider({ children }: { children: React.ReactNode }) {
  const services = usePluginServices<OfficialServices>()
  const { t, locale } = useTranslation()
  const localeRef = useRef(locale)
  useEffect(() => {
    localeRef.current = locale
  }, [locale])
  const { hasHydrated } = useSessionSnapshot()
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated)
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted)
  const updateMirror = useSettingsStore((s) => s.updateMirror)
  const updateChannel = useSettingsStore((s) => s.updateChannel)
  const setUpdateStatus = useUpdateStore((s) => s.setUpdateStatus)
  const { provider, snapshot, isReady } = useProviderContext()
  const didNotifyAppReady = useRef(false)
  const didRunStartupSideEffects = useRef(false)
  const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false)

  const trackLaunch = useCallback(
    () =>
      services.analytics.track(
        {
          version: APP_VERSION,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          screen: `${window.screen.width}x${window.screen.height}`,
          platform: isCapacitor() ? "android" : "web",
          ua: navigator.userAgent,
        },
        {
          enabled: useSettingsStore.getState().analyticsConsent,
          oncePerDay: true,
          dedupeKey: "app-launch",
        }
      ),
    [services.analytics]
  )

  const performUpdateCheck = useCallback(async () => {
    if (!isCapacitor()) return
    const info = await services.updater.checkForUpdate({
      automatic: true,
      mirror: updateMirror,
      channel: updateChannel,
    })
    const hasUpdate = info.available || info.apkUpdateAvailable
    setUpdateStatus(hasUpdate)
    if (hasUpdate) {
      const { setUpdateInfo, setShowDialog } = useUpdateStore.getState()
      setUpdateInfo(info)
      blurActiveElement()
      setShowDialog(true)
    }
  }, [services.updater, updateMirror, updateChannel, setUpdateStatus])

  const checkAnnouncementsThenUpdates = useCallback(async () => {
    const info = await services.announcement.check()
    if (info) {
      const { setAnnouncementInfo, setShowDialog } = useAnnouncementStore.getState()
      setAnnouncementInfo(info)
      blurActiveElement()
      setShowDialog(true)
      return
    }
    await performUpdateCheck()
  }, [performUpdateCheck, services.announcement])

  // Inject safe area CSS variables on native.
  // The Capacitor SystemBars plugin may report zero values for WebView < 140
  // due to a Chromium bug (crbug.com/40699457). Our native plugin reads the
  // real root-window insets and corrects them.
  useEffect(() => {
    if (!isCapacitor()) return

    const inject = () => {
      invokeNativeCapability("native.webview", "initSafeArea").catch(() => {})
    }

    // Inject immediately and on every resize (rotation, keyboard, etc.)
    inject()
    window.addEventListener("resize", inject)
    return () => window.removeEventListener("resize", inject)
  }, [])

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated) return

    // Signal the updater plugin that the current bundle loaded successfully.
    // Must run before provider session initialization to maximize the chance it fires within appReadyTimeout.
    if (!didNotifyAppReady.current) {
      didNotifyAppReady.current = true
      if (isCapacitor()) {
        import("@capgo/capacitor-updater").then(({ CapacitorUpdater }) => {
          CapacitorUpdater.notifyAppReady().catch(() => {})
        })
      }
    }

    if (!isReady) return

    let cancelled = false
    void (async () => {
        if (cancelled) return

        if (cancelled) return
        services.query.invalidate()

        if (didRunStartupSideEffects.current || !onboardingCompleted) return
        didRunStartupSideEffects.current = true

        // Show analytics consent prompt if user hasn't made a choice yet
        const analyticsPromptVersion = useSettingsStore.getState().analyticsPromptVersion
        if (!analyticsPromptVersion) {
          blurActiveElement()
          setShowAnalyticsPrompt(true)
        } else {
          // User already made a choice: check announcements then updates
          checkAnnouncementsThenUpdates()
          // Fire-and-forget: anonymous usage stats
          trackLaunch().catch(() => {})
        }

        // Check WebView compatibility (Capacitor only)
        if (isCapacitor()) {
          invokeNativeCapability("native.webview", "check", {
            locale: localeRef.current,
          }).catch(() => {})
        }

        // Background: verify auth + warm up WEU tokens after the UI is
        // already visible so the user sees cached data immediately.
        ;(async () => {
          let status = await provider.checkAuthStatus()
          if (!status.authenticated) {
            // Cookie restoration may not be immediately effective on
            // Capacitor; wait briefly and retry once before concluding
            // the session is actually expired.
            await new Promise((r) => setTimeout(r, 800))
            status = await provider.checkAuthStatus()
          }
          if (cancelled || !services.session.getSnapshot().isAuthenticated) return
          if (status.authenticated) {
            services.session.setSessionExpired(false)
            provider.warmup?.().catch(() => {})
          } else {
            services.session.setSessionExpired(true)
            toast.error(t("app.sessionExpired"))
          }
        })().catch((err) => {
          if (cancelled || !services.session.getSnapshot().isAuthenticated) return
          const e = err as Error & { code?: string; status?: number }
          if (e.code === "AUTH_REQUIRED" || e.code === "AUTH_SESSION_EXPIRED" || e.status === 401) {
            services.session.setSessionExpired(true)
            toast.error(t("app.sessionExpired"))
          }
          // Silently ignore non-auth errors during startup to avoid
          // false alarms caused by transient network issues.
        })
      })()
      .catch((err) => {
        if (cancelled) return
        if (!services.session.getSnapshot().isAuthenticated) return
        const e = err as Error & { code?: string; status?: number }
        if (e.code === "AUTH_REQUIRED" || e.code === "AUTH_SESSION_EXPIRED" || e.status === 401) {
          services.session.setSessionExpired(true)
          toast.error(t("app.sessionExpired"))
        }
        // Silently ignore non-auth errors during startup to avoid
        // false alarms caused by transient network issues.
      })

    return () => {
      cancelled = true
    }
  }, [
    hasHydrated,
    settingsHydrated,

    isReady,
    onboardingCompleted,
    provider,
    t,
    checkAnnouncementsThenUpdates,
    trackLaunch,
    services.query,
    services.session,
  ])

  useEffect(() => {
    if (snapshot.status !== "error" || !snapshot.error) return
    if (!services.session.getSnapshot().isAuthenticated) return
    const error = snapshot.error as Error & { code?: string; status?: number }
    if (
      error.code === "AUTH_REQUIRED" ||
      error.code === "AUTH_SESSION_EXPIRED" ||
      error.status === 401
    ) {
      services.session.setSessionExpired(true)
      toast.error(t("app.sessionExpired"))
    }
  }, [snapshot, t, services.session])

  if (!hasHydrated || !settingsHydrated) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground" suppressHydrationWarning>
          {t("app.updating")}
        </div>
      </div>
    )
  }

  return (
    <>
      {children}
      <AnalyticsPrompt
        open={showAnalyticsPrompt}
        onClose={() => {
          setShowAnalyticsPrompt(false)
          useSettingsStore.getState().setAnalyticsPromptVersion(APP_VERSION)
          // Check announcements then updates after privacy prompt is closed
          checkAnnouncementsThenUpdates()
          // Try to track launch if user agreed
          trackLaunch().catch(() => {})
        }}
      />
      <AnnouncementDialog onDismissed={performUpdateCheck} />
    </>
  )
}
