import {
  createObservableSource,
  type ObservableSource,
  type PluginKeyValueStorage,
} from "@orahako/sdk"

export const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const CONTROLLER_CHANGE_TIMEOUT_MS = 1_500
const REGISTRATION_READY_TIMEOUT_MS = 1_500
const VERSION_REPLY_TIMEOUT_MS = 1_000

const PWA_LAST_CHECK_KEY = "pwa-last-update-check"
const PWA_DISMISSED_KEY = "pwa-dismissed-update"
const PWA_OFFLINE_READY_KEY = "pwa-offline-ready"
const PWA_OFFLINE_READY_STANDALONE_KEY = "pwa-offline-ready-standalone"

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{
    readonly outcome: "accepted" | "dismissed"
    readonly platform: string
  }>
}

export interface PwaInstallState {
  readonly deferredPrompt: BeforeInstallPromptEvent | null
  readonly installed: boolean
  readonly isIos: boolean
}

export interface PwaControllerOptions {
  readonly storage: PluginKeyValueStorage
  readonly isNative: () => boolean
  readonly basePath?: string
  readonly enableServiceWorker?: boolean
  readonly onUpdateAvailable: (available: boolean) => void
  readonly onOfflineReady?: () => void
}

export interface PwaController {
  readonly installState: ObservableSource<PwaInstallState>
  start(): void
  promptInstall(): Promise<{
    readonly outcome: "accepted" | "dismissed"
    readonly platform: string
  } | null>
  prepareWebUpdate(options?: {
    readonly force?: boolean
  }): Promise<ServiceWorkerRegistration | null>
  applyWebUpdate(): Promise<void>
  dismissWebUpdate(): Promise<void>
  dispose(): void
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false
  const { userAgent = "", platform = "", maxTouchPoints = 0 } = navigator
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)
}

function hasIosStandaloneFlag(): boolean {
  if (typeof navigator === "undefined") return false
  return "standalone" in navigator && navigator.standalone === true
}

function buildTimestamp(version: string | null): number {
  if (!version) return 0
  const match = /-(\d{10,})$/.exec(version)
  return match ? Number(match[1]) : 0
}

function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function" && "userChoice" in event
}

function askBuildVersion(worker: ServiceWorker): Promise<string | null> {
  if (typeof MessageChannel === "undefined") return Promise.resolve(null)
  return new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (version: string | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(version)
    }
    const channel = new MessageChannel()
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data
      const version =
        typeof data === "object" && data !== null && "version" in data ? data.version : null
      finish(typeof version === "string" ? version : null)
    }
    const timer = setTimeout(() => finish(null), VERSION_REPLY_TIMEOUT_MS)
    try {
      worker.postMessage({ type: "GET_VERSION" }, [channel.port2])
    } catch {
      finish(null)
    }
  })
}

function isProductionEnv(): boolean {
  const proc: unknown = "process" in globalThis ? Reflect.get(globalThis, "process") : undefined
  if (typeof proc !== "object" || proc === null || !("env" in proc)) return false
  const env: unknown = proc.env
  return (
    typeof env === "object" && env !== null && "NODE_ENV" in env && env.NODE_ENV === "production"
  )
}

export function createPwaController({
  storage,
  isNative,
  basePath = "",
  enableServiceWorker = isProductionEnv(),
  onUpdateAvailable,
  onOfflineReady,
}: PwaControllerOptions): PwaController {
  const installSource = createObservableSource<PwaInstallState>({
    deferredPrompt: null,
    installed: false,
    isIos: false,
  })
  const cleanups: Array<() => void> = []
  let started = false
  let disposed = false
  let installedByEvent = false
  let watchedRegistration: ServiceWorkerRegistration | null = null

  const normalizedBasePath = basePath.replace(/\/+$/, "")

  const isPwaSupported = (): boolean =>
    typeof window !== "undefined" &&
    Boolean(window.isSecureContext) &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    !isNative()

  const evaluateRegistration = async (registration: ServiceWorkerRegistration): Promise<void> => {
    if (disposed) return
    const waiting = registration.waiting
    const controller = navigator.serviceWorker.controller
    if (!waiting || !controller) return

    const [waitingVersion, activeVersion] = await Promise.all([
      askBuildVersion(waiting),
      askBuildVersion(controller),
    ])
    if (
      waitingVersion &&
      activeVersion &&
      buildTimestamp(waitingVersion) <= buildTimestamp(activeVersion)
    ) {
      return
    }

    const dismissed = await storage.getItem(PWA_DISMISSED_KEY).catch(() => null)
    if (dismissed !== null && dismissed === (waitingVersion ?? "unknown")) {
      return
    }

    if (!disposed) {
      onUpdateAvailable(true)
    }
  }

  const watchRegistration = (registration: ServiceWorkerRegistration): void => {
    if (watchedRegistration === registration) {
      void evaluateRegistration(registration)
      return
    }
    watchedRegistration = registration
    void evaluateRegistration(registration)
    const onUpdateFound = () => {
      const worker = registration.installing
      if (!worker) return
      const onStateChange = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          void evaluateRegistration(registration)
        }
      }
      worker.addEventListener("statechange", onStateChange)
    }
    registration.addEventListener("updatefound", onUpdateFound)
    cleanups.push(() => registration.removeEventListener("updatefound", onUpdateFound))
  }

  const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
    if (!isPwaSupported()) return null
    if (watchedRegistration) return watchedRegistration
    const scopeHref = new URL(`${normalizedBasePath}/`, window.location.origin).href
    const existing = await navigator.serviceWorker.getRegistration(scopeHref)
    if (existing) return existing
    return Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), REGISTRATION_READY_TIMEOUT_MS)
      ),
    ])
  }

  const prepareWebUpdate = async (options?: {
    readonly force?: boolean
  }): Promise<ServiceWorkerRegistration | null> => {
    try {
      const target = await getRegistration()
      if (!target || disposed) return null
      watchRegistration(target)

      if (!options?.force) {
        const rawLast = await storage.getItem(PWA_LAST_CHECK_KEY).catch(() => null)
        const lastCheck = Number(rawLast || 0)
        if (Date.now() - lastCheck < PWA_UPDATE_CHECK_INTERVAL_MS) {
          return target
        }
      }
      await storage.setItem(PWA_LAST_CHECK_KEY, String(Date.now())).catch(() => {})
      await target.update()
      await evaluateRegistration(target)
      return target
    } catch {
      return null
    }
  }

  const dismissWebUpdate = async (): Promise<void> => {
    onUpdateAvailable(false)
    let version: string | null = null
    try {
      const registration = await getRegistration()
      if (registration?.waiting) {
        version = await askBuildVersion(registration.waiting)
      }
    } catch {
      // Fall through to "unknown".
    }
    await storage.setItem(PWA_DISMISSED_KEY, version ?? "unknown").catch(() => {})
  }

  const applyWebUpdate = async (): Promise<void> => {
    let registration: ServiceWorkerRegistration | null = null
    try {
      registration = await getRegistration()
    } catch {
      // Reloading HTML can still pick up a fresh build.
    }
    await storage.removeItem(PWA_DISMISSED_KEY).catch(() => {})

    const waitingWorker = registration?.waiting
    if (!waitingWorker) {
      if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
        window.location.reload()
      }
      return
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeoutId)
        navigator.serviceWorker.removeEventListener("controllerchange", finish)
        resolve()
      }
      navigator.serviceWorker.addEventListener("controllerchange", finish, { once: true })
      const timeoutId = setTimeout(finish, CONTROLLER_CHANGE_TIMEOUT_MS)
      try {
        waitingWorker.postMessage({ type: "SKIP_WAITING" })
      } catch {
        finish()
      }
    })

    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload()
    }
  }

  const start = (): void => {
    if (started || disposed || typeof window === "undefined") return
    started = true

    // 1. PWA install prompt capture
    const standaloneQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null
    const detectStandalone = (): boolean =>
      Boolean(standaloneQuery?.matches) || hasIosStandaloneFlag()

    installSource.set({
      deferredPrompt: null,
      installed: detectStandalone(),
      isIos: detectIos(),
    })

    const onBeforeInstallPrompt = (event: Event) => {
      if (!isBeforeInstallPromptEvent(event)) return
      event.preventDefault()
      installSource.set((prev) => ({ ...prev, deferredPrompt: event }))
    }
    const onAppInstalled = () => {
      installedByEvent = true
      installSource.set((prev) => ({ ...prev, deferredPrompt: null, installed: true }))
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt)
    window.addEventListener("appinstalled", onAppInstalled)
    cleanups.push(() => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt)
      window.removeEventListener("appinstalled", onAppInstalled)
    })

    if (standaloneQuery && typeof standaloneQuery.addEventListener === "function") {
      const onDisplayModeChange = (event: MediaQueryListEvent) => {
        installSource.set((prev) => ({
          ...prev,
          installed: event.matches || detectStandalone() || installedByEvent,
        }))
      }
      standaloneQuery.addEventListener("change", onDisplayModeChange)
      cleanups.push(() => standaloneQuery.removeEventListener("change", onDisplayModeChange))
    }

    // 2. Service Worker registration & periodic checks on Web
    if (!enableServiceWorker || !isPwaSupported()) return

    const offlineKey = detectStandalone() ? PWA_OFFLINE_READY_STANDALONE_KEY : PWA_OFFLINE_READY_KEY
    navigator.serviceWorker
      .register(`${normalizedBasePath}/sw.js`, { updateViaCache: "none" })
      .then(async (target) => {
        if (disposed) return
        watchRegistration(target)
        void prepareWebUpdate()

        const alreadyMarked = await storage.getItem(offlineKey).catch(() => null)
        if (alreadyMarked || disposed) return
        await navigator.serviceWorker.ready
        if (disposed) return
        await storage.setItem(offlineKey, "1").catch(() => {})
        onOfflineReady?.()
      })
      .catch(() => {})

    const checkVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void prepareWebUpdate()
      }
    }
    const intervalId = setInterval(checkVisible, PWA_UPDATE_CHECK_INTERVAL_MS)
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", checkVisible)
    }
    cleanups.push(() => {
      clearInterval(intervalId)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", checkVisible)
      }
    })
  }

  return {
    installState: {
      getSnapshot: installSource.getSnapshot,
      subscribe: installSource.subscribe,
    },
    start,
    async promptInstall() {
      const current = installSource.getSnapshot().deferredPrompt
      if (!current) return null
      try {
        await current.prompt()
        return await current.userChoice
      } finally {
        installSource.set((prev) =>
          prev.deferredPrompt === current ? { ...prev, deferredPrompt: null } : prev
        )
      }
    },
    prepareWebUpdate,
    applyWebUpdate,
    dismissWebUpdate,
    dispose() {
      if (disposed) return
      disposed = true
      for (let i = cleanups.length - 1; i >= 0; i -= 1) {
        cleanups[i]?.()
      }
      cleanups.length = 0
    },
  }
}
