"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor } from "@/lib/native/platform";
import { initializePwaInstallCapture } from "@/lib/pwa-install";
import {
  prepareWebUpdate,
  watchPwaRegistration,
} from "@/lib/pwa-updater";

const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;
const OFFLINE_READY_KEY = "academic-client-pwa-offline-ready";

export function PwaRegister() {
  const { t } = useTranslation();
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    initializePwaInstallCapture();

    if (
      process.env.NODE_ENV !== "production" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      isCapacitor()
    ) {
      return;
    }

    const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
    const wasControlled = navigator.serviceWorker.controller !== null;
    let registration: ServiceWorkerRegistration | null = null;
    let disposed = false;

    navigator.serviceWorker
      .register(`${basePath}/sw.js`, { updateViaCache: "none" })
      .then(async (target) => {
        if (disposed) return;
        registration = target;
        watchPwaRegistration(target);
        void prepareWebUpdate(target);

        if (wasControlled || localStorage.getItem(OFFLINE_READY_KEY)) return;
        await navigator.serviceWorker.ready;
        if (disposed) return;
        localStorage.setItem(OFFLINE_READY_KEY, "1");
        toast.success(tRef.current("app.offlineReady"));
      })
      .catch(() => {});

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void prepareWebUpdate(registration);
      }
    };
    const intervalId = window.setInterval(
      checkForUpdate,
      UPDATE_CHECK_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", checkForUpdate);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkForUpdate);
    };
  }, []);

  return null;
}
