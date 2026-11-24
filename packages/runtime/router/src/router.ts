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
  type RouterBackFallback,
  type RouterBackGuard,
  type RouteTargetInput,
  type ScopedPluginService,
} from "@orahako/sdk"

export const ROUTER_RUNTIME_PLUGIN_ID = "orahako.runtime.router"

const HISTORY_INDEX_KEY = "orahakoIndex"
const HISTORY_ENTRIES_KEY = "orahakoEntries"

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

interface HistoryRouteState {
  readonly index: number
  readonly entries: readonly string[]
}

function readHistoryState(state: unknown): HistoryRouteState | undefined {
  if (typeof state !== "object" || state === null) return undefined
  const record = state as Record<string, unknown>
  const index = record[HISTORY_INDEX_KEY]
  const entries = record[HISTORY_ENTRIES_KEY]
  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) return undefined
  if (!Array.isArray(entries) || entries.length === 0) return undefined
  if (!entries.every((entry) => typeof entry === "string")) return undefined
  if (index >= entries.length) return undefined
  return { index, entries }
}

interface GuardEntry {
  readonly guard: RouterBackGuard
  readonly priority: number
  active: boolean
}

/**
 * Reactive History API router with in-memory fallback, prioritized back guards,
 * and Capacitor hardware back button integration.
 *
 * `registerBackGuard` evaluates active guards by descending priority, then LIFO:
 * returning `false` (or a Promise resolving to `false`) intercepts/cancels
 * history navigation, while returning `true` allows navigation to proceed.
 * Async guard evaluation is single-flight and rejections veto the back request.
 *
 * The in-memory stack is mirrored in `history.state`. After a refresh the persisted
 * index is only reused when it still points at the current href; otherwise the
 * router rebuilds a single-entry safe stack and normalizes the current entry.
 */
export class PluginRouter implements PluginRouterService, ScopedPluginService<PluginRouterService> {
  readonly current: ObservableSource<RouteLocation>
  private readonly currentSource: ReturnType<typeof createObservableSource<RouteLocation>>
  private readonly basePath: string
  private readonly browserWindow?: BrowserWindowLike
  private readonly entries: string[]
  private readonly backGuards: GuardEntry[] = []
  private readonly backFallbacks: RouterBackFallback[] = []
  private index = 0
  private backInFlight = false
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
      const href =
        `${this.browserWindow.location.pathname || "/"}${this.browserWindow.location.search}`
      const nextLocation = parseRouteLocation(href)
      const stored = readHistoryState(event.state ?? this.browserWindow.history.state)
      if (stored && stored.entries[stored.index] === nextLocation.href) {
        this.entries.splice(0, this.entries.length, ...stored.entries)
        this.index = stored.index
      } else {
        const matchedIndex = this.entries.lastIndexOf(nextLocation.href)
        if (matchedIndex >= 0) {
          this.index = matchedIndex
          this.entries[matchedIndex] = nextLocation.href
        } else {
          this.entries.splice(0, this.entries.length, nextLocation.href)
          this.index = 0
        }
      }
      this.browserWindow.history.replaceState(this.createHistoryState(), "", nextLocation.href)
      this.currentSource.set(nextLocation)
    }

    if (this.browserWindow) {
      const stored = readHistoryState(this.browserWindow.history.state)
      if (stored && stored.entries[stored.index] === initialLocation.href) {
        this.entries.splice(0, this.entries.length, ...stored.entries)
        this.index = stored.index
      }
      this.browserWindow.history.replaceState(this.createHistoryState(), "", initialLocation.href)
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
      registerBackGuard: (guard, priority) =>
        trackPluginRegistration(ctx, () => this.registerBackGuard(guard, priority)),
      registerBackFallback: (fallback) =>
        trackPluginRegistration(ctx, () => this.registerBackFallback(fallback)),
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
      this.browserWindow.history.pushState(this.createHistoryState(), "", nextLocation.href)
    }
    this.currentSource.set(nextLocation)
  }

  replace = (target: RouteTargetInput): void => {
    if (this.disposed) return
    const nextHref = this.href(target)
    const nextLocation = parseRouteLocation(nextHref)
    this.entries[this.index] = nextLocation.href
    if (this.browserWindow) {
      this.browserWindow.history.replaceState(this.createHistoryState(), "", nextLocation.href)
    }
    this.currentSource.set(nextLocation)
  }

  registerBackGuard = (guard: RouterBackGuard, priority = 0): (() => void) => {
    const entry: GuardEntry = { guard, priority, active: true }
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

  registerBackFallback = (fallback: RouterBackFallback): (() => void) => {
    this.backFallbacks.push(fallback)
    return () => {
      const index = this.backFallbacks.lastIndexOf(fallback)
      if (index >= 0) this.backFallbacks.splice(index, 1)
    }
  }

  back = (): void => {
    if (this.disposed || this.backInFlight) return
    const snapshot = [...this.backGuards]
      .reverse()
      .sort((left, right) => right.priority - left.priority)
    this.backInFlight = true
    let outcome: boolean | Promise<boolean>
    try {
      outcome = this.evaluateBackGuards(snapshot)
    } catch {
      outcome = false
    }
    if (isPromiseLikeBoolean(outcome)) {
      void outcome.then((allowed) => this.finishBack(allowed), () => this.finishBack(false))
      return
    }
    this.finishBack(outcome)
  }

  async dispatchHardwareBack(
    _canGoBack = false,
    onExit?: () => void | Promise<void>
  ): Promise<boolean> {
    if (this.disposed) return false
    if (this.backInFlight) return true
    const snapshot = [...this.backGuards]
      .reverse()
      .sort((left, right) => right.priority - left.priority)
    this.backInFlight = true
    try {
      const allowed = await this.evaluateBackGuards(snapshot)
      if (this.disposed || !allowed) return true
      if (this.performHistoryBack()) return true
      await onExit?.()
      return false
    } finally {
      this.backInFlight = false
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.backInFlight = false
    this.backGuards.length = 0
    this.backFallbacks.length = 0
    if (this.browserWindow) {
      this.browserWindow.removeEventListener("popstate", this.handlePopState)
    }
    const listener = this.hardwareListener
    this.hardwareListener = undefined
    if (listener) {
      void listener.remove().catch(() => {})
    }
  }

  private evaluateBackGuards(snapshot: readonly GuardEntry[]): boolean | Promise<boolean> {
    for (let i = 0; i < snapshot.length; i += 1) {
      const entry = snapshot[i]
      if (!entry || !entry.active) continue
      let outcome: boolean | Promise<boolean>
      try {
        outcome = entry.guard()
      } catch {
        return false
      }
      if (isPromiseLikeBoolean(outcome)) {
        return this.evaluateRemainingBackGuards(outcome, snapshot, i + 1)
      }
      if (!outcome) return false
    }
    return true
  }

  private async evaluateRemainingBackGuards(
    pending: Promise<boolean>,
    snapshot: readonly GuardEntry[],
    startAt: number
  ): Promise<boolean> {
    try {
      if (!(await pending) || this.disposed) return false
    } catch {
      return false
    }
    for (let i = startAt; i < snapshot.length; i += 1) {
      const entry = snapshot[i]
      if (!entry || !entry.active) continue
      try {
        if (!(await entry.guard()) || this.disposed) return false
      } catch {
        return false
      }
    }
    return true
  }

  private finishBack(allowed: boolean): void {
    this.backInFlight = false
    if (this.disposed || !allowed) return
    this.performHistoryBack()
  }

  private createHistoryState(): Record<string, unknown> {
    return {
      [HISTORY_INDEX_KEY]: this.index,
      [HISTORY_ENTRIES_KEY]: [...this.entries],
    }
  }

  private performHistoryBack(): boolean {
    if (this.disposed) return false
    if (this.index > 0) {
      this.index -= 1
      const targetHref = this.entries[this.index]!
      if (this.browserWindow) {
        this.browserWindow.history.back()
      }
      this.currentSource.set(parseRouteLocation(targetHref))
      return true
    }
    for (let index = this.backFallbacks.length - 1; index >= 0; index -= 1) {
      const fallback = this.backFallbacks[index]?.()
      if (fallback !== undefined) {
        this.replace(fallback)
        return true
      }
    }
    return false
  }

  private attachHardwareBack(adapter: HardwareBackAdapter): void {
    void adapter
      .addListener("backButton", ({ canGoBack }) => {
        void this.dispatchHardwareBack(canGoBack, () => adapter.exitApp?.()).catch(() => {})
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
