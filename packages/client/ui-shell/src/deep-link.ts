import {
  isCurrentNotificationDestination,
  notificationDestination,
  type PluginLocale,
  type PluginNativeService,
  type PluginNavigationService,
  type PluginRouterService,
} from "@orahako/sdk"

export const NATIVE_WEBVIEW_CAPABILITY = "native.webview@1"

export interface CapacitorAppUrlAdapter {
  addListener(
    eventName: "appUrlOpen",
    listenerFunc: (event: { readonly url: string }) => void
  ): Promise<{ remove(): Promise<void> }>
  getLaunchUrl(): Promise<{ readonly url?: string } | undefined>
}

export function parseDeepLink(
  url: string,
  navigation: Pick<PluginNavigationService, "resolve" | "sources">,
  scheme: string
): string | null {
  return notificationDestination(url, navigation, scheme)
}

export interface DeepLinkListenerOptions {
  readonly isNative: () => boolean
  readonly scheme: string
  readonly navigation: Pick<PluginNavigationService, "resolve" | "sources">
  readonly router: Pick<PluginRouterService, "current" | "push">
  readonly appAdapter?: CapacitorAppUrlAdapter
}

export function attachDeepLinkListener(options: DeepLinkListenerOptions): () => void {
  if (!options.isNative() || !options.scheme) {
    return () => {}
  }

  let disposed = false
  let receivedWarmUrl = false
  let removeListener: (() => Promise<void>) | undefined

  const handleUrl = (url: string): boolean => {
    if (disposed) return false
    const destination = parseDeepLink(url, options.navigation, options.scheme)
    if (!destination) return false
    const current = options.router.current.getSnapshot()
    if (!isCurrentNotificationDestination(current.pathname, current.search, destination)) {
      options.router.push(destination)
    }
    return true
  }

  const loadAdapter = options.appAdapter
    ? Promise.resolve(options.appAdapter)
    : import("@capacitor/app").then(({ App }) => App)

  void loadAdapter
    .then(async (app) => {
      if (disposed) return
      const handle = await app.addListener("appUrlOpen", ({ url }) => {
        if (handleUrl(url)) {
          receivedWarmUrl = true
        }
      })
      if (disposed) {
        await handle.remove()
        return
      }
      removeListener = () => handle.remove()
      const launch = await app.getLaunchUrl()
      if (!disposed && !receivedWarmUrl && launch?.url) {
        handleUrl(launch.url)
      }
    })
    .catch(() => {
      // Ignore unavailable Capacitor App bridge in headless environments.
    })

  return () => {
    disposed = true
    const cleanup = removeListener
    removeListener = undefined
    if (cleanup) {
      void cleanup().catch(() => {})
    }
  }
}

export interface NativeWebViewLifecycleOptions {
  readonly native: PluginNativeService
  readonly getLocale: () => PluginLocale
  readonly targetWindow?: {
    addEventListener(type: "resize", listener: () => void): void
    removeEventListener(type: "resize", listener: () => void): void
  }
}

export function attachNativeWebViewLifecycle(options: NativeWebViewLifecycleOptions): () => void {
  if (!options.native.isNative) {
    return () => {}
  }

  let disposed = false
  const invokeWebView = (method: string, payload?: Record<string, unknown>): void => {
    if (disposed || !options.native.isNative) return
    if (!options.native.capabilities.has(NATIVE_WEBVIEW_CAPABILITY)) return
    void options.native.capabilities
      .invoke(NATIVE_WEBVIEW_CAPABILITY, method, payload)
      .catch(() => {})
  }

  const handleResize = (): void => {
    invokeWebView("initSafeArea")
  }

  invokeWebView("initSafeArea")
  invokeWebView("check", { locale: options.getLocale() })

  const win =
    options.targetWindow ??
    (typeof window !== "undefined" && typeof window.addEventListener === "function"
      ? window
      : undefined)

  if (win) {
    win.addEventListener("resize", handleResize)
  }

  return () => {
    disposed = true
    if (win) {
      win.removeEventListener("resize", handleResize)
    }
  }
}
