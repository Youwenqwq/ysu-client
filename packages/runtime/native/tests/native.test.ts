import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const companionMocks = vi.hoisted(() => ({
  isNative: false,
  describe: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  invoke: vi.fn(),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
}))

const capacitorAppMocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  getLaunchUrl: vi.fn(),
}))

vi.mock("@capacitor/app", () => ({
  // Capacitor exposes plugin methods through a Proxy, including a `then`
  // method that makes the namespace object a permanently pending thenable.
  App: new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "addListener") return capacitorAppMocks.addListener
        if (property === "getLaunchUrl") return capacitorAppMocks.getLaunchUrl
        if (property === "then") return () => {}
        return undefined
      },
    }
  ),
}))

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => companionMocks.isNative,
  },
  registerPlugin: () => ({
    describe: companionMocks.describe,
    acquire: companionMocks.acquire,
    release: companionMocks.release,
    invoke: companionMocks.invoke,
    addListener: companionMocks.addListener,
  }),
}))

import { PluginRuntime } from "@orahako/kernel"
import {
  createObservableSource,
  definePlugin,
  cancelLocalNotification,
  clearCalendarNamespace,
  ensureNotificationChannel,
  ensureNotificationChannels,
  getNotificationChannelStatus,
  openNotificationSettings,
  parseRouteLocation,
  PLUGIN_API_VERSION,
  postLocalNotification,
  removeCalendarEvents,
  syncCalendarNamespace,
  upsertCalendarEvents,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  type NativeCapabilityDescriptor,
  type PluginNativeCapabilityService,
  type PluginNativeService,
  type PluginNavigationService,
  type PluginRouterService,
  type PluginWidgetService,
  type RouteLocation,
  type RouteTargetInput,
} from "@orahako/sdk"
import {
  attachDeepLinkListener,
  createNativeService,
  NATIVE_FILES_CAPABILITY,
  nativeRuntimePlugin,
  NOTIFICATIONS_CORE_CAPABILITY,
  widgetRuntimePlugin,
} from "../src/index"

function createMockCapabilities<R = unknown>(
  descriptors: readonly NativeCapabilityDescriptor[],
  handler: (id: string, method: string, payload?: Record<string, unknown>) => R
): PluginNativeCapabilityService {
  const find = (ref: string) => {
    const at = ref.lastIndexOf("@")
    const id = at > 0 ? ref.slice(0, at) : ref
    const version = at > 0 ? Number(ref.slice(at + 1)) : undefined
    return descriptors.find(
      (item) => item.id === id && (version === undefined || item.version === version)
    )
  }

  return {
    list: () => descriptors,
    has: (ref) => find(ref) !== undefined,
    acquire: vi.fn(async (ref) => {
      if (!find(ref)) throw new Error(`Unknown native capability: ${ref}`)
      return vi.fn(async () => {})
    }),
    invoke: async <T>(ref: string, method: string, payload?: Record<string, unknown>) => {
      if (!find(ref)) throw new Error(`Unknown native capability: ${ref}`)
      const result: unknown = await handler(ref, method, payload)
      return result as T
    },
  }
}

describe("@orahako/runtime-native", () => {
  beforeEach(() => {
    companionMocks.isNative = false
    companionMocks.describe.mockReset()
    companionMocks.acquire.mockReset()
    companionMocks.release.mockReset()
    companionMocks.invoke.mockReset()
    capacitorAppMocks.addListener.mockReset()
    capacitorAppMocks.getLaunchUrl.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("implements saveImage via native.files@1 and permission flows via notifications.core@1", async () => {
    const calls: Array<{ id: string; method: string; payload?: Record<string, unknown> }> = []
    let notifGranted = false
    let exactGranted = false
    let batteryIgnored = false

    const capabilities = createMockCapabilities(
      [
        { id: "native.files", version: 1, methods: ["saveImageToGallery"] },
        {
          id: "notifications.core",
          version: 1,
          methods: [
            "checkPermissions",
            "requestPermissions",
            "checkExactAlarmPermission",
            "requestExactAlarmPermission",
            "checkBatteryOptimization",
            "requestIgnoreBatteryOptimization",
          ],
        },
      ],
      (id, method, payload) => {
        calls.push({ id, method, ...(payload !== undefined ? { payload } : {}) })
        if (id === NATIVE_FILES_CAPABILITY && method === "saveImageToGallery") {
          return { uri: "content://media/external/images/media/42" }
        }
        if (id === NOTIFICATIONS_CORE_CAPABILITY) {
          switch (method) {
            case "checkPermissions":
              return { granted: notifGranted }
            case "requestPermissions":
              notifGranted = true
              return { granted: true }
            case "checkExactAlarmPermission":
              return { granted: exactGranted }
            case "requestExactAlarmPermission":
              exactGranted = true
              return { granted: true }
            case "checkBatteryOptimization":
              return { ignored: batteryIgnored }
            case "requestIgnoreBatteryOptimization":
              batteryIgnored = true
              return { ignored: true }
            default:
              break
          }
        }
        return {}
      }
    )

    const native = createNativeService({
      isNative: () => true,
      capabilities,
      loadCapabilities: async () => capabilities.list(),
    })

    expect(native.isNative).toBe(true)
    expect(native.capabilities.has("native.files@1")).toBe(true)

    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })
    const saved = await native.saveImage(blob, "qrcode.png")
    expect(saved).toEqual({ uri: "content://media/external/images/media/42" })
    expect(calls[0]).toEqual({
      id: "native.files@1",
      method: "saveImageToGallery",
      payload: {
        base64: btoa(String.fromCharCode(137, 80, 78, 71)),
        mimeType: "image/png",
        fileName: "qrcode.png",
      },
    })

    // First call checks then requests; second call short-circuits on check
    expect(await native.requestNotificationPermission()).toBe(true)
    expect(await native.requestNotificationPermission()).toBe(true)
    expect(await native.requestExactAlarmPermission()).toBe(true)
    expect(await native.requestBatteryOptimizationExemption()).toBe(true)

    expect(calls.map((entry) => `${entry.id}:${entry.method}`)).toEqual([
      "native.files@1:saveImageToGallery",
      "notifications.core@1:checkPermissions",
      "notifications.core@1:requestPermissions",
      "notifications.core@1:checkPermissions",
      "notifications.core@1:checkExactAlarmPermission",
      "notifications.core@1:requestExactAlarmPermission",
      "notifications.core@1:checkBatteryOptimization",
      "notifications.core@1:requestIgnoreBatteryOptimization",
    ])
  })

  it("exposes generic notification and namespaced calendar helpers for any plugin", async () => {
    const calls: Array<{ id: string; method: string; payload?: Record<string, unknown> }> = []
    const capabilities = createMockCapabilities(
      [
        { id: "notifications.core", version: 1, methods: [] },
        { id: "calendar.sync", version: 1, methods: [] },
      ],
      (id, method, payload) => {
        calls.push({ id, method, payload })
        switch (`${id}:${method}`) {
          case "notifications.core@1:ensureChannel":
            return { id: payload?.id, created: true }
          case "notifications.core@1:ensureChannels":
            return { channels: [{ id: "community.alerts", created: true }] }
          case "notifications.core@1:getChannelStatus":
            return { id: payload?.id, exists: true, importance: 4, blocked: false }
          case "notifications.core@1:openNotificationSettings":
            return { opened: true }
          case "notifications.core@1:post":
            return { id: 42, tag: payload?.tag ?? null, posted: true }
          case "notifications.core@1:cancel":
            return { cancelled: 1 }
          case "calendar.sync@1:sync":
          case "calendar.sync@1:upsert":
            return {
              namespace: payload?.namespace,
              synced: 1,
              created: 1,
              updated: 0,
              deleted: 0,
              calendarId: 9,
              dedicated: true,
            }
          case "calendar.sync@1:remove":
            return { deleted: 1 }
          case "calendar.sync@1:clear":
            return { cleared: true }
          default:
            throw new Error(`Unexpected ${id}:${method}`)
        }
      }
    )

    const native = createNativeService({
      isNative: () => true,
      capabilities,
      loadCapabilities: async () => [],
    })

    expect(
      await ensureNotificationChannel(native, {
        id: "community.alerts",
        name: "Alerts",
        importance: "high",
        lockscreenVisibility: "public",
      })
    ).toEqual({ id: "community.alerts", created: true })
    expect(
      await ensureNotificationChannels(native, [{ id: "community.alerts", name: "Alerts" }])
    ).toEqual([{ id: "community.alerts", created: true }])
    expect(await getNotificationChannelStatus(native, "community.alerts")).toMatchObject({
      id: "community.alerts",
      exists: true,
      blocked: false,
    })
    expect(await openNotificationSettings(native, "community.alerts")).toBe(true)
    expect(
      await postLocalNotification(native, {
        channelId: "community.alerts",
        title: "Library due",
        body: "Return book tomorrow",
      })
    ).toMatchObject({ id: 42, posted: true })
    expect(await cancelLocalNotification(native, { channelId: "community.alerts" })).toBe(1)

    const sampleEvent = { uid: "book-1", title: "Return book", startAt: 1000, endAt: 2000 }
    expect(
      await syncCalendarNamespace(native, {
        namespace: "community.library",
        events: [sampleEvent],
      })
    ).toMatchObject({ namespace: "community.library", created: 1 })
    expect(
      await upsertCalendarEvents(native, {
        namespace: "community.library",
        events: [sampleEvent],
      })
    ).toMatchObject({ namespace: "community.library", created: 1 })
    expect(await removeCalendarEvents(native, "community.library", ["book-1"])).toBe(1)
    expect(await clearCalendarNamespace(native, "community.library")).toBe(true)

    expect(calls.find((c) => c.method === "openNotificationSettings")?.payload).toEqual({
      channelId: "community.alerts",
    })
    expect(calls.find((c) => c.method === "clear")?.payload).toEqual({
      namespace: "community.library",
    })
  })

  it("handles Web Notification fallback and non-native permission guards cleanly", async () => {
    const native = createNativeService({
      isNative: () => false,
    })

    expect(native.isNative).toBe(false)
    expect(await native.requestExactAlarmPermission()).toBe(false)
    expect(await native.requestBatteryOptimizationExemption()).toBe(false)

    // No global Notification API -> false
    vi.stubGlobal("Notification", undefined)
    expect(await native.requestNotificationPermission()).toBe(false)

    // Web Notification API prompt -> granted
    const requestPermission = vi.fn(async () => "granted" as const)
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission,
    })
    expect(await native.requestNotificationPermission()).toBe(true)
    expect(requestPermission).toHaveBeenCalledOnce()

    // Denied Web Notification -> false without prompting
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission,
    })
    expect(await native.requestNotificationPermission()).toBe(false)
    expect(requestPermission).toHaveBeenCalledOnce()
  })

  it("wires nativeRuntimePlugin and widgetRuntimePlugin through Cordis and invokes widget capabilities", async () => {
    companionMocks.isNative = true
    companionMocks.describe.mockResolvedValue({
      capabilities: [
        {
          id: "widgets.generic",
          version: 1,
          methods: ["list", "pin", "update", "settings", "reconcile", "clear"],
        },
        {
          id: "widgets.schedule",
          version: 1,
          methods: ["sync"],
        },
      ],
    })
    companionMocks.invoke.mockImplementation(
      async ({
        id,
        method,
        payload,
      }: {
        id: string
        method: string
        payload?: Record<string, unknown>
      }) => {
        if (id === WIDGETS_GENERIC_CAPABILITY && method === "list") {
          return {
            widgets: [
              {
                id: "schedule",
                provider: ".ScheduleWidgetReceiver",
                capability: WIDGETS_SCHEDULE_CAPABILITY,
              },
            ],
          }
        }
        if (id === WIDGETS_GENERIC_CAPABILITY && method === "pin") {
          return { added: payload?.["widget"] === "schedule" }
        }
        if (id === WIDGETS_SCHEDULE_CAPABILITY && method === "sync") {
          return { synced: true }
        }
        return {}
      }
    )

    const runtime = new PluginRuntime()
    let injectedNative!: PluginNativeService
    let injectedWidgets!: PluginWidgetService

    const consumer = definePlugin({
      manifest: {
        id: "plugin.widget-consumer",
        name: "Widget Consumer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["native", "widgets"],
      },
      inject: ["native", "widgets"] as const,
      apply(ctx) {
        injectedNative = ctx.native
        injectedWidgets = ctx.widgets
      },
    })

    try {
      runtime.register(nativeRuntimePlugin, "builtin")
      runtime.register(widgetRuntimePlugin, "builtin")
      runtime.register(consumer, "builtin")

      await runtime.startAndWait(nativeRuntimePlugin.manifest.id)
      await runtime.startAndWait(widgetRuntimePlugin.manifest.id)
      await runtime.startAndWait(consumer.manifest.id)

      expect(injectedNative.isNative).toBe(true)
      expect(injectedNative.capabilities.has(WIDGETS_GENERIC_CAPABILITY)).toBe(true)

      const list = await injectedWidgets.list()
      expect(list).toHaveLength(1)
      expect(list[0]?.id).toBe("schedule")

      expect(await injectedWidgets.requestPin("schedule")).toBe(true)
      await injectedWidgets.update("schedule", { week: 5 }, { showWeekend: true })
      await injectedWidgets.updateSettings(null, { compact: false })
      await injectedWidgets.reconcile()
      await injectedWidgets.clear("schedule")
      const custom = await injectedWidgets.invoke<{ synced: boolean }>(
        WIDGETS_SCHEDULE_CAPABILITY,
        "sync",
        { force: true }
      )
      expect(custom).toEqual({ synced: true })

      expect(companionMocks.invoke).toHaveBeenCalledWith({
        id: WIDGETS_GENERIC_CAPABILITY,
        method: "update",
        payload: {
          widget: "schedule",
          snapshot: { week: 5 },
          settings: { showWeekend: true },
        },
      })

      // Capability lease acquire + idempotent release
      companionMocks.acquire.mockResolvedValueOnce({
        token: "lease-1",
        id: "widgets.generic",
        version: 1,
        dependencies: [],
      })
      companionMocks.release.mockResolvedValueOnce({ released: true })
      const releaseLease = await injectedNative.capabilities.acquire(WIDGETS_GENERIC_CAPABILITY)
      await releaseLease()
      await releaseLease()
      expect(companionMocks.acquire).toHaveBeenCalledTimes(1)
      expect(companionMocks.release).toHaveBeenCalledTimes(1)
      expect(companionMocks.release).toHaveBeenCalledWith({ token: "lease-1" })
    } finally {
      runtime.dispose()
    }
  })

  it("defers cold-start deep links until feature pages and provider filters become ready", async () => {
    const createMemoryRouter = (initialHref: string) => {
      const history: string[] = [initialHref]
      const current = createObservableSource<RouteLocation>(parseRouteLocation(initialHref))
      const toHref = (target: RouteTargetInput): string => {
        if (typeof target === "string") return target
        if ("route" in target) return `/?route=${target.route}`
        return `/?plugin=${target.pluginId}&page=${target.pageId ?? "index"}`
      }
      const router: Pick<PluginRouterService, "current" | "push" | "replace" | "href"> & {
        history: string[]
      } = {
        history,
        current,
        href: toHref,
        push: (target) => {
          const next = toHref(target)
          history.push(next)
          current.set(parseRouteLocation(next))
        },
        replace: (target) => {
          const next = toHref(target)
          history[history.length - 1] = next
          current.set(parseRouteLocation(next))
        },
      }
      return router
    }

    const navState = createObservableSource(0)
    const routes = new Map<string, { pluginId: string; pageId: string }>()
    const navigation: Pick<PluginNavigationService, "resolve" | "sources" | "state"> = {
      state: navState,
      resolve: (id) => {
        const found = routes.get(id)
        return found ? { ...found, source: "page" as const } : undefined
      },
      sources: () => ({ pages: [], navigation: [], fallbackHref: "/" }),
    }

    // 1. Cold start via retained appUrlOpen before `orahako.exams` / provider is ready
    const router = createMemoryRouter("/")
    const dispose = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation,
      router,
      appAdapter: {
        async addListener(_event, listener) {
          // Simulates Capacitor BridgeActivity onCreate -> onNewIntent retainUntilConsumed=true
          listener({ url: "orahako://exams" })
          return { remove: async () => {} }
        },
        async getLaunchUrl() {
          return { url: "orahako://exams" }
        },
      },
    })

    // Immediately parks on `/?route=exams` (replacing bare `/`) so OrahakoApp won't redirect to overview
    await vi.waitFor(() => expect(router.current.getSnapshot().href).toBe("/?route=exams"))
    expect(router.history).toEqual(["/?route=exams"])

    // Provider initializes & exams route becomes resolvable -> canonicalizes in place
    routes.set("exams", { pluginId: "orahako.exams", pageId: "index" })
    navState.set((n) => n + 1)

    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.exams&page=index")
    expect(router.history).toEqual(["/?plugin=orahako.exams&page=index"])
    dispose()

    // 2. Cold start after landing redirect already moved `/` to overview, before `exams` resolves
    routes.clear()
    const warmBootRouter = createMemoryRouter("/?plugin=orahako.overview&page=index")
    const disposeWarmBoot = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation,
      router: warmBootRouter,
      appAdapter: {
        async addListener() {
          return { remove: async () => {} }
        },
        async getLaunchUrl() {
          return { url: "orahako://exams" }
        },
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    // Does not blank the active overview page while waiting
    expect(warmBootRouter.current.getSnapshot().href).toBe("/?plugin=orahako.overview&page=index")

    routes.set("exams", { pluginId: "orahako.exams", pageId: "index" })
    navState.set((n) => n + 1)
    expect(warmBootRouter.current.getSnapshot().href).toBe("/?plugin=orahako.exams&page=index")
    disposeWarmBoot()

    // 3. Slow provider initialization must not expire the user's deep-link intent
    vi.useFakeTimers()
    routes.clear()
    const slowProviderRouter = createMemoryRouter("/")
    const disposeSlowProvider = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation,
      router: slowProviderRouter,
      appAdapter: {
        async addListener() {
          return { remove: async () => {} }
        },
        async getLaunchUrl() {
          return { url: "orahako://schedule" }
        },
      },
    })

    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(slowProviderRouter.current.getSnapshot().href).toBe("/?route=schedule")

      await vi.advanceTimersByTimeAsync(5_000)
      routes.set("schedule", { pluginId: "orahako.schedule", pageId: "index" })
      navState.set((n) => n + 1)

      expect(slowProviderRouter.current.getSnapshot().href).toBe(
        "/?plugin=orahako.schedule&page=index"
      )
    } finally {
      disposeSlowProvider()
      vi.useRealTimers()
    }

    // 4. Auth redirect / manual navigation cancels pending deep link
    routes.clear()
    const authRouter = createMemoryRouter("/")
    const disposeAuth = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation,
      router: authRouter,
      appAdapter: {
        async addListener() {
          return { remove: async () => {} }
        },
        async getLaunchUrl() {
          return { url: "orahako://exams" }
        },
      },
    })

    await vi.waitFor(() => expect(authRouter.current.getSnapshot().href).toBe("/?route=exams"))
    authRouter.replace({ route: "login" })
    routes.set("exams", { pluginId: "orahako.exams", pageId: "index" })
    navState.set((n) => n + 1)
    expect(authRouter.current.getSnapshot().href).toBe("/?route=login")
    disposeAuth()
  })

  it("initializes deep links when the Capacitor App plugin is a thenable Proxy", async () => {
    const current = createObservableSource<RouteLocation>(parseRouteLocation("/"))
    const router: Pick<PluginRouterService, "current" | "push"> = {
      current,
      push: (target) => {
        if (typeof target !== "string") throw new Error("Expected a formatted destination")
        current.set(parseRouteLocation(target))
      },
    }
    capacitorAppMocks.addListener.mockResolvedValue({ remove: async () => {} })
    capacitorAppMocks.getLaunchUrl.mockResolvedValue({ url: "orahako://exams" })

    const dispose = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation: {
        resolve: (id) =>
          id === "exams"
            ? { pluginId: "orahako.exams", pageId: "index", source: "page" }
            : undefined,
        sources: () => ({ pages: [], navigation: [], fallbackHref: "/" }),
      },
      router,
    })

    await vi.waitFor(() =>
      expect(current.getSnapshot().href).toBe("/?plugin=orahako.exams&page=index")
    )
    expect(capacitorAppMocks.addListener).toHaveBeenCalledWith("appUrlOpen", expect.any(Function))
    dispose()
  })
})
