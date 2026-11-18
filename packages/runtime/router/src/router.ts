import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  definePlugin,
  formatRouteHref,
  isCapacitor,
  parseRouteLocation,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type ObservableSource,
  type PluginManifest,
  type PluginRouterService,
  type RouteLocation,
  type RouterBackGuard,
  type RouteTargetInput,
  type ScopedPluginService,
} from "@orahako/sdk"

export const ROUTER_RUNTIME_PLUGIN_ID = "orahako.runtime.router"

export interface RouterRuntimeConfig {
  readonly basePath?: string
  readonly initialHref?: string
  readonly [key: string]: unknown
}

export interface BrowserHistoryLike {
  readonly state?: unknown
  pushState(data: unknown, unused: string, url?: string | URL | null): void
  replaceState(data: unknown, unused: string, url?: string | URL | null): void
  back(): void
}

export interface BrowserWindowLike {
  readonly location: {
    readonly pathname: string
    readonly search: string
  }
  readonly history: BrowserHistoryLike
  addEventListener(type: "popstate", listener: (event: PopStateEvent) => void): void
  removeEventListener(type: "popstate", listener: (event: PopStateEvent) => void): void
}

export interface HardwareBackListenerHandle {
  remove(): Promise<void>
}

export interface HardwareBackAdapter {
  addListener(
    eventName: "backButton",
    listenerFunc: (event: { canGoBack: boolean }) => void
  ): Promise<HardwareBackListenerHandle>
  exitApp?(): Promise<void>
}

export interface PluginRouterOptions {
  readonly basePath?: string
  readonly initialHref?: string
  readonly window?: BrowserWindowLike | null
  readonly hardwareBack?: HardwareBackAdapter | null
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath) return ""
  const trimmed = basePath.replace(/\/+$/, "")
  if (!trimmed || trimmed === "/") return ""
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function detectBrowserWindow(): BrowserWindowLike | undefined {
  if (
    typeof window !== "undefined" &&
    typeof window.location === "object" &&
    window.location !== null &&
    typeof window.history === "object" &&
    window.history !== null &&
    typeof window.history.pushState === "function" &&
    typeof window.history.replaceState === "function" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
  ) {
    return window
  }
  return undefined
}

function isPromiseLikeBoolean(value: boolean | Promise<boolean>): value is Promise<boolean> {
  return typeof value === "object" && value !== null && "then" in value
}

function readStateIndex(state: unknown): number | undefined {
  if (
    typeof state === "object" &&
    state !== null &&
    "orahakoIndex" in state &&
    typeof state.orahakoIndex === "number"
  ) {
    return state.orahakoIndex
  }
  return undefined
}

interface GuardEntry {
  readonly guard: RouterBackGuard
  active: boolean
}

/**
 * Reactive History API router with in-memory fallback, LIFO back guards, and
 * Capacitor hardware back button integration.
 *
 * `registerBackGuard` evaluates active guards in LIFO order before history back:
 * returning `false` (or a Promise resolving to `false`) intercepts/cancels
 * history navigation, while returning `true` allows navigation to proceed.
 */
export class PluginRouter implements PluginRouterService, ScopedPluginService<PluginRouterService> {
  readonly current: ObservableSource<RouteLocation>
  private readonly currentSource: ReturnType<typeof createObservableSource<RouteLocation>>
  private readonly basePath: string
  private readonly browserWindow?: BrowserWindowLike
  private readonly entries: string[]
  private readonly backGuards: GuardEntry[] = []
  private index = 0
  private disposed = false
  private hardwareListener?: HardwareBackListenerHandle
  private readonly handlePopState: (event: PopStateEvent) => void

  constructor(options: PluginRouterOptions = {}) {
    this.basePath = normalizeBasePath(options.basePath)
    this.browserWindow =
      options.window === null ? undefined : (options.window ?? detectBrowserWindow())

    const initialRaw =
      options.initialHref !== undefined
        ? this.href(options.initialHref)
        : this.browserWindow
          ? `${this.browserWindow.location.pathname || "/"}${this.browserWindow.location.search}`
          : this.href("/")

    const initialLocation = parseRouteLocation(initialRaw)
    this.entries = [initialLocation.href]
    this.currentSource = createObservableSource<RouteLocation>(initialLocation)
    this.current = {
      getSnapshot: this.currentSource.getSnapshot,
      subscribe: this.currentSource.subscribe,
    }

    this.handlePopState = (event: PopStateEvent) => {
      if (this.disposed || !this.browserWindow) return
      const href = `${this.browserWindow.location.pathname || "/"}${this.browserWindow.location.search}`
      const stateIndex = readStateIndex(event.state ?? this.browserWindow.history.state)
      if (stateIndex !== undefined && stateIndex >= 0 && stateIndex < this.entries.length) {
        this.index = stateIndex
        this.entries[this.index] = href
      } else if (this.index > 0 && this.entries[this.index - 1] === href) {
        this.index -= 1
      }
      this.currentSource.set(parseRouteLocation(href))
    }

    if (this.browserWindow) {
      if (options.initialHref !== undefined) {
        this.browserWindow.history.replaceState({ orahakoIndex: 0 }, "", initialLocation.href)
      }
      this.browserWindow.addEventListener("popstate", this.handlePopState)
    }

    if (options.hardwareBack !== null) {
      if (options.hardwareBack) {
        this.attachHardwareBack(options.hardwareBack)
      } else if (isCapacitor()) {
        void import("@capacitor/app")
          .then(({ App }) => {
            if (!this.disposed) {
              this.attachHardwareBack(App)
            }
          })
          .catch(() => {})
      }
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, _manifest: PluginManifest): PluginRouterService {
    return {
      current: this.current,
      push: this.push,
      replace: this.replace,
      back: this.back,
      href: this.href,
      registerBackGuard: (guard) =>
        trackPluginRegistration(ctx, () => this.registerBackGuard(guard)),
    }
  }

  href = (target: RouteTargetInput): string => {
    if (
      typeof target === "string" &&
      this.basePath &&
      (target === this.basePath || target.startsWith(`${this.basePath}/`))
    ) {
      return target
    }
    return formatRouteHref(target, this.basePath)
  }

  push = (target: RouteTargetInput): void => {
    if (this.disposed) return
    const nextHref = this.href(target)
    const nextLocation = parseRouteLocation(nextHref)
    this.entries.splice(this.index + 1)
    this.entries.push(nextLocation.href)
    this.index = this.entries.length - 1
    if (this.browserWindow) {
      this.browserWindow.history.pushState({ orahakoIndex: this.index }, "", nextLocation.href)
    }
    this.currentSource.set(nextLocation)
  }

  replace = (target: RouteTargetInput): void => {
    if (this.disposed) return
    const nextHref = this.href(target)
    const nextLocation = parseRouteLocation(nextHref)
    this.entries[this.index] = nextLocation.href
    if (this.browserWindow) {
      this.browserWindow.history.replaceState({ orahakoIndex: this.index }, "", nextLocation.href)
    }
    this.currentSource.set(nextLocation)
  }

  registerBackGuard = (guard: RouterBackGuard): (() => void) => {
    const entry: GuardEntry = { guard, active: true }
    this.backGuards.push(entry)
    return () => {
      if (!entry.active) return
      entry.active = false
      const idx = this.backGuards.indexOf(entry)
      if (idx >= 0) {
        this.backGuards.splice(idx, 1)
      }
    }
  }

  back = (): void => {
    if (this.disposed) return
    const snapshot = [...this.backGuards].reverse()
    this.runGuardsSyncOrAsync(snapshot, 0, () => {
      this.performHistoryBack()
    })
  }

  async dispatchHardwareBack(
    canGoBack = false,
    onExit?: () => void | Promise<void>
  ): Promise<boolean> {
    if (this.disposed) return false
    const snapshot = [...this.backGuards].reverse()
    for (const entry of snapshot) {
      if (!entry.active) continue
      const allowed = await entry.guard()
      if (!allowed) {
        return true
      }
    }
    if (this.index > 0 || (this.browserWindow && canGoBack)) {
      this.performHistoryBack(canGoBack)
      return true
    }
    await onExit?.()
    return false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.backGuards.length = 0
    if (this.browserWindow) {
      this.browserWindow.removeEventListener("popstate", this.handlePopState)
    }
    const listener = this.hardwareListener
    this.hardwareListener = undefined
    if (listener) {
      void listener.remove().catch(() => {})
    }
  }

  private runGuardsSyncOrAsync(
    snapshot: readonly GuardEntry[],
    startAt: number,
    onAllowed: () => void
  ): void {
    for (let i = startAt; i < snapshot.length; i += 1) {
      const entry = snapshot[i]
      if (!entry || !entry.active) continue
      const outcome = entry.guard()
      if (isPromiseLikeBoolean(outcome)) {
        void outcome.then((allowed) => {
          if (this.disposed || !allowed) return
          this.runGuardsSyncOrAsync(snapshot, i + 1, onAllowed)
        })
        return
      }
      if (!outcome) return
    }
    onAllowed()
  }

  private performHistoryBack(browserCanGoBack = false): void {
    if (this.disposed) return
    if (this.index > 0) {
      this.index -= 1
      const targetHref = this.entries[this.index]!
      if (this.browserWindow) {
        this.browserWindow.history.back()
      }
      this.currentSource.set(parseRouteLocation(targetHref))
      return
    }
    if (this.browserWindow && browserCanGoBack) {
      this.browserWindow.history.back()
    }
  }

  private attachHardwareBack(adapter: HardwareBackAdapter): void {
    void adapter
      .addListener("backButton", ({ canGoBack }) => {
        void this.dispatchHardwareBack(canGoBack, () => adapter.exitApp?.())
      })
      .then((handle) => {
        if (this.disposed) {
          void handle.remove().catch(() => {})
        } else {
          this.hardwareListener = handle
        }
      })
      .catch(() => {})
  }
}

export const routerRuntimePlugin = definePlugin({
  manifest: {
    id: ROUTER_RUNTIME_PLUGIN_ID,
    name: "路由服务",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "基于查询参数与 History API 的响应式路由及返回守卫服务",
    provides: ["router"],
  },
  configSchema: {
    type: "object",
    properties: {
      basePath: { type: "string" },
      initialHref: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: RouterRuntimeConfig = {}) {
    const router = new PluginRouter({
      ...(config.basePath !== undefined ? { basePath: config.basePath } : {}),
      ...(config.initialHref !== undefined ? { initialHref: config.initialHref } : {}),
    })
    ctx.effect(() => () => {
      router.dispose()
    })
    ctx.set("router", router)
  },
})
