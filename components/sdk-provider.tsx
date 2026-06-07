"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mutate } from "swr";
import { toast } from "sonner";
import { getActiveProvider, initializeActiveProvider, setActiveProviderSchool } from "@/providers/provider-service";
import { useAuthStore } from "@/lib/stores/auth";
import { useSettingsStore } from "@/lib/stores/settings";
import { useUpdateStore } from "@/lib/stores/update";
import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor } from "@/lib/native/platform";
import { initSafeArea } from "@/lib/native/webview-compat";
import { trackAppLaunch } from "@/lib/analytics";
import { syncFeedbackReplies } from "@/lib/feedback-check";
import { AnalyticsPrompt } from "@/components/analytics-prompt";
import { APP_VERSION } from "@/lib/version";
import { useAnnouncementStore } from "@/lib/stores/announcement";
import { checkAnnouncement } from "@/lib/announcement";
import { AnnouncementDialog } from "@/components/announcement-dialog";

export function SDKProvider({ children }: { children: React.ReactNode }) {
  const { t, locale } = useTranslation();
  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated);
  const schoolId = useSettingsStore((s) => s.schoolId);
  const updateMirror = useSettingsStore((s) => s.updateMirror);
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const setUpdateStatus = useUpdateStore((s) => s.setUpdateStatus);
  const didInit = useRef(false);
  const [showAnalyticsPrompt, setShowAnalyticsPrompt] = useState(false);

  const performUpdateCheck = useCallback(async () => {
    if (!isCapacitor()) return;
    const { checkForUpdate } = await import("@/lib/updater");
    const info = await checkForUpdate(true, updateMirror, updateChannel);
    const hasUpdate = info.available || info.apkUpdateAvailable;
    setUpdateStatus(hasUpdate);
    if (hasUpdate) {
      const { setUpdateInfo, setShowDialog } = useUpdateStore.getState();
      setUpdateInfo(info);
      setShowDialog(true);
    }
  }, [updateMirror, updateChannel, setUpdateStatus]);

  const checkAnnouncementsThenUpdates = useCallback(async () => {
    const info = await checkAnnouncement();
    if (info) {
      const { setAnnouncementInfo, setShowDialog } = useAnnouncementStore.getState();
      setAnnouncementInfo(info);
      setShowDialog(true);
      return;
    }
    await performUpdateCheck();
  }, [performUpdateCheck]);

  // Inject safe area CSS variables on native.
  // The Capacitor SystemBars plugin may report zero values for WebView < 140
  // due to a Chromium bug (crbug.com/40699457). Our native plugin reads the
  // real root-window insets and corrects them.
  useEffect(() => {
    if (!isCapacitor()) return;

    const inject = () => {
      initSafeArea().catch(() => {});
    };

    // Inject immediately and on every resize (rotation, keyboard, etc.)
    inject();
    window.addEventListener("resize", inject);
    return () => window.removeEventListener("resize", inject);
  }, []);

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated || didInit.current) return;
    didInit.current = true;

    // Signal the updater plugin that the current bundle loaded successfully.
    // Must run before provider session initialization to maximize the chance it fires within appReadyTimeout.
    if (isCapacitor()) {
      import("@capgo/capacitor-updater").then(({ CapacitorUpdater }) => {
        CapacitorUpdater.notifyAppReady().catch(() => {});
      });
    }

    setActiveProviderSchool(schoolId);

    initializeActiveProvider()
      .then(() => {
        mutate((key) => Array.isArray(key) && key[0] === "provider");

        // Show analytics consent prompt if user hasn't made a choice yet
        const analyticsPromptVersion = useSettingsStore.getState().analyticsPromptVersion;
        if (!analyticsPromptVersion) {
          setShowAnalyticsPrompt(true);
        } else {
          // User already made a choice: check announcements then updates
          checkAnnouncementsThenUpdates();
          // Fire-and-forget: anonymous usage stats
          trackAppLaunch().catch(() => {});
        }

        // Check feedback replies once on startup
        syncFeedbackReplies().catch(() => {});

        // Check WebView compatibility (Capacitor only)
        if (isCapacitor()) {
          import("@/lib/native/webview-compat").then(({ checkWebViewCompat }) => {
            checkWebViewCompat(localeRef.current);
          });
        }

        // Background: verify auth + warm up WEU tokens after the UI is
        // already visible so the user sees cached data immediately.
        (async () => {
          const provider = getActiveProvider();
          let status = await provider.checkAuthStatus();
          if (!status.authenticated) {
            // Cookie restoration may not be immediately effective on
            // Capacitor; wait briefly and retry once before concluding
            // the session is actually expired.
            await new Promise((r) => setTimeout(r, 800));
            status = await provider.checkAuthStatus();
          }
          if (status.authenticated) {
            provider.warmup?.().catch(() => {});
          }
          if (!status.authenticated) {
            toast.error(t("app.sessionExpired"));
          }
        })().catch((err) => {
          const e = err as Error & { code?: string; status?: number };
          if (e.code === "AUTH_REQUIRED" || e.status === 401) {
            toast.error(t("app.sessionExpired"));
          }
          // Silently ignore non-auth errors during startup to avoid
          // false alarms caused by transient network issues.
        });
      })
      .catch((err) => {
        const e = err as Error & { code?: string; status?: number };
        if (e.code === "AUTH_REQUIRED" || e.status === 401) {
          toast.error(t("app.sessionExpired"));
        }
        // Silently ignore non-auth errors during startup to avoid
        // false alarms caused by transient network issues.
      });
  }, [hasHydrated, settingsHydrated, schoolId, setUpdateStatus, t, updateMirror, updateChannel, checkAnnouncementsThenUpdates]);

  if (!hasHydrated || !settingsHydrated) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground" suppressHydrationWarning>
          {t("app.updating")}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <AnalyticsPrompt
        open={showAnalyticsPrompt}
        onClose={() => {
          setShowAnalyticsPrompt(false);
          useSettingsStore.getState().setAnalyticsPromptVersion(APP_VERSION);
          // Check announcements then updates after privacy prompt is closed
          checkAnnouncementsThenUpdates();
          // Try to track launch if user agreed
          trackAppLaunch().catch(() => {});
        }}
      />
      <AnnouncementDialog onDismissed={performUpdateCheck} />
    </>
  );
}
