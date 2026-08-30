"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { useTranslation } from "@/lib/i18n/use-translation"
import { isCapacitor } from "@/lib/native/platform"
import { initializePwaInstallCapture } from "@/lib/pwa-install"
import {
  PWA_UPDATE_CHECK_INTERVAL_MS,
  prepareWebUpdate,
  watchPwaRegistration,
} from "@/lib/pwa-updater"
const OFFLINE_READY_KEY = "academic-client-pwa-offline-ready"
const OFFLINE_READY_STANDALONE_KEY = "academic-client-pwa-offline-ready-standalone"

export function PwaRegister() {
  const { t } = useTranslation()
  const tRef = useRef(t)

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    initializePwaInstallCapture()

    if (
      process.env.NODE_ENV !== "production" ||
      !window.isSecureContext ||
      !("serviceWorker" in navigator) ||
      isCapacitor()
    ) {
      return
    }

    const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || ""
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const offlineReadyKey = isStandalone ? OFFLINE_READY_STANDALONE_KEY : OFFLINE_READY_KEY
    let registration: ServiceWorkerRegistration | null = null
    let disposed = false

    navigator.serviceWorker
      .register(`${basePath}/sw.js`, { updateViaCache: "none" })
      .then(async (target) => {
        if (disposed) return
        registration = target
        watchPwaRegistration(target)
        void prepareWebUpdate(target)

        if (localStorage.getItem(offlineReadyKey)) return
        await navigator.serviceWorker.ready
        if (disposed) return
        localStorage.setItem(offlineReadyKey, "1")
        toast.success(tRef.current("app.offlineReady"))
      })
      .catch(() => {})

    const checkForUpdate = () => {
      if (document.visibilityState === "visible") {
        void prepareWebUpdate(registration)
      }
    }
    const intervalId = window.setInterval(checkForUpdate, PWA_UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", checkForUpdate)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", checkForUpdate)
    }
  }, [])

  return null
}
