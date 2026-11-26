import {
  definePlugin,
  isCurrentNotificationDestination,
  notificationDestination,
  parseDeepLinkRoute,
  PLUGIN_API_VERSION,
  pluginPageHref,
  semanticRouteHref,
  type PluginConfig,
  type PluginLocale,
  type PluginNativeService,
  type PluginNavigationService,
  type PluginRouterService,
} from "@orahako/sdk"

export const NATIVE_LIFECYCLE_RUNTIME_PLUGIN_ID = "orahako.runtime.native-lifecycle"
export const NATIVE_WEBVIEW_CAPABILITY = "native.webview@1"

const handledLaunchNatives = new WeakSet<PluginNativeService>()

export interface NativeLifecycleConfig extends PluginConfig {
  readonly deepLinkScheme?: string
}

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
  readonly navigation: Pick<PluginNavigationService, "resolve" | "sources"> &
    Partial<Pick<PluginNavigationService, "state">>
  readonly router: Pick<PluginRouterService, "current" | "push"> &
    Partial<Pick<PluginRouterService, "replace" | "href">>
  readonly appAdapter?: CapacitorAppUrlAdapter
  readonly shouldHandleLaunchUrl?: (url: string) => boolean
  readonly onLaunchUrlHandled?: (url: string) => void
}

export function attachDeepLinkListener(options: DeepLinkListenerOptions): () => void {
  if (!options.isNative() || !options.scheme) {
    return () => {}
  }

  let disposed = false
  let receivedWarmUrl = false
  let removeListener: (() => Promise<void>) | undefined
  let cancelPending: (() => void) | undefined

  const clearPending = (): void => {
    const cancel = cancelPending
    cancelPending = undefined
    cancel?.()
  }

  const navigateTo = (target: string, preferReplace: boolean): void => {
    const formatted = options.router.href ? options.router.href(target) : target
    const current = options.router.current.getSnapshot()
    if (isCurrentNotificationDestination(current.pathname, current.search, formatted)) {
      return
    }
    if (preferReplace && options.router.replace) {
      options.router.replace(target)
    } else {
      options.router.push(target)
    }
  }

  const handleUrl = (url: string): boolean => {
    if (disposed) return false
    const route = parseDeepLinkRoute(url, options.scheme)
    if (!route) return false

    clearPending()

    const current = options.router.current.getSnapshot()
    const isAtBareRoot = !current.route && !current.pluginId
    const resolved = options.navigation.resolve(route)
    if (resolved) {
      navigateTo(pluginPageHref(resolved.pluginId, resolved.pageId), isAtBareRoot)
      return true
    }

    const navState = options.navigation.state
    if (!navState) {
      const fallback = options.navigation.sources().fallbackHref
      if (fallback) navigateTo(fallback, isAtBareRoot)
      return true
    }

    // On cold start, feature plugins and school providers may not have mounted
    // or initialized yet. Park on `/?route=<route>` so the app shell does not
    // redirect to the default landing page while we wait for the target route.
    const parkedOnRoute = isAtBareRoot || current.route === route
    if (isAtBareRoot) {
      navigateTo(semanticRouteHref(route), true)
    }

    const startHref = options.router.current.getSnapshot().href
    let active = true
    let unsubNav: (() => void) | undefined
    let unsubRouter: (() => void) | undefined

    const cleanupPending = (): void => {
      if (!active) return
      active = false
      unsubNav?.()
      unsubNav = undefined
      unsubRouter?.()
      unsubRouter = undefined
      if (cancelPending === cleanupPending) {
        cancelPending = undefined
      }
    }

    cancelPending = cleanupPending

    const tryResolvePending = (): void => {
      if (!active || disposed) {
        cleanupPending()
        return
      }
      const target = options.navigation.resolve(route)
      if (!target) return
      cleanupPending()
      const now = options.router.current.getSnapshot()
      navigateTo(
        pluginPageHref(target.pluginId, target.pageId),
        parkedOnRoute && now.route === route
      )
    }

    unsubNav = navState.subscribe(tryResolvePending)
    unsubRouter = options.router.current.subscribe(() => {
      if (!active || disposed) return
      if (options.router.current.getSnapshot().href !== startHref) {
        cleanupPending()
      }
    })

    tryResolvePending()
    return true
  }

  // Capacitor plugin proxies expose `then` as a plugin method. Resolve only a
  // plain wrapper so Promise assimilation never calls that method and stalls.
  const loadAdapter = options.appAdapter
    ? Promise.resolve({ app: options.appAdapter })
    : import("@capacitor/app").then(({ App }) => ({ app: App }))

  void loadAdapter
    .then(async ({ app }) => {
      if (disposed) return
      const handle = await app.addListener("appUrlOpen", ({ url }) => {
        if (handleUrl(url)) {
          receivedWarmUrl = true
          options.onLaunchUrlHandled?.(url)
        }
      })
      if (disposed) {
        await handle.remove()
        return
      }
      removeListener = () => handle.remove()
      const launch = await app.getLaunchUrl()
      if (
        !disposed &&
        !receivedWarmUrl &&
        launch?.url &&
        (options.shouldHandleLaunchUrl?.(launch.url) ?? true)
      ) {
        if (handleUrl(launch.url)) {
          options.onLaunchUrlHandled?.(launch.url)
        }
      }
    })
    .catch(() => {
      // Ignore unavailable Capacitor App bridge in headless environments.
    })

  return () => {
    disposed = true
    clearPending()
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

export const nativeLifecycleRuntimePlugin = definePlugin<
  readonly ["native"],
  NativeLifecycleConfig,
  readonly ["router", "navigation", "i18n"]
>({
  manifest: {
    id: NATIVE_LIFECYCLE_RUNTIME_PLUGIN_ID,
    name: "Native WebView and deep-link lifecycle",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    inject: ["native"],
    nativeCapabilities: [NATIVE_WEBVIEW_CAPABILITY],
  },
  inject: ["native"] as const,
  optionalInject: ["router", "navigation", "i18n"] as const,
  configSchema: {
    type: "object",
    properties: {
      deepLinkScheme: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: NativeLifecycleConfig = {}) {
    const scheme = config.deepLinkScheme ?? "orahako"
    const disposeWebView = attachNativeWebViewLifecycle({
      native: ctx.native,
      getLocale: () => ctx.i18n?.getLocale() ?? "zh",
    })
    const disposeDeepLinks =
      ctx.router && ctx.navigation
        ? attachDeepLinkListener({
            isNative: () => ctx.native.isNative,
            scheme,
            navigation: ctx.navigation,
            router: ctx.router,
            shouldHandleLaunchUrl: () => !handledLaunchNatives.has(ctx.native),
            onLaunchUrlHandled: () => {
              handledLaunchNatives.add(ctx.native)
            },
          })
        : () => {}

    ctx.effect(() => () => {
      disposeDeepLinks()
      disposeWebView()
    })
  },
})
