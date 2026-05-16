"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { initSDK } from "@/lib/sdk";
import { checkAuthStatus } from "@/lib/api";
import { warmupWEU } from "@/lib/jwxt";
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore } from "@/lib/settings-store";
import { useUpdateStore } from "@/lib/update-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor } from "@/lib/platform";

export function SDKProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const settingsHydrated = useSettingsStore((s) => s.hasHydrated);
  const updateMirror = useSettingsStore((s) => s.updateMirror);
  const setUpdateStatus = useUpdateStore((s) => s.setUpdateStatus);
  const didInit = useRef(false);
  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    if (!hasHydrated || !settingsHydrated || didInit.current) return;
    didInit.current = true;

    // Signal the updater plugin that the current bundle loaded successfully.
    // Must run before initSDK() to maximize the chance it fires within appReadyTimeout.
    if (isCapacitor()) {
      import("@capgo/capacitor-updater").then(({ CapacitorUpdater }) => {
        CapacitorUpdater.notifyAppReady().catch(() => {});
      });
    }

    // Fire-and-forget: check for updates independently (Capacitor only)
    if (isCapacitor()) {
      import("@/lib/updater").then(({ checkForUpdate }) => {
        checkForUpdate(true, updateMirror)
          .then((info) => {
            const hasUpdate = info.available || info.apkUpdateAvailable;
            setUpdateStatus(hasUpdate);
            if (info.apkUpdateAvailable) {
              toast.info(
                t("update.apkAvailable").replace("{version}", info.version),
              );
            } else if (info.available) {
              toast.info(
                t("update.available").replace("{version}", info.version),
              );
            }
          })
          .catch(() => {});
      });
    }

    initSDK()
      .then(() => {
        setSdkReady(true);

        // Background: verify auth + warm up WEU tokens after the UI is
        // already visible so the user sees cached data immediately.
        (async () => {
          let status = await checkAuthStatus();
          if (!status.authenticated) {
            // Cookie restoration may not be immediately effective on
            // Capacitor; wait briefly and retry once before concluding
            // the session is actually expired.
            await new Promise((r) => setTimeout(r, 800));
            status = await checkAuthStatus();
          }
          if (status.authenticated) {
            warmupWEU().catch(() => {});
            import("@/lib/jwmobile").then(({ ensureMobileAuthorized }) => {
              ensureMobileAuthorized(true).catch(() => {});
            });
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
        setSdkReady(true);
      });
  }, [hasHydrated, settingsHydrated, setUpdateStatus, t, updateMirror]);

  if (!hasHydrated || !settingsHydrated || !sdkReady) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground" suppressHydrationWarning>
          {t("app.updating")}
        </div>
      </div>
    );
  }

  return children;
}
