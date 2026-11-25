import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  notificationRegistryRuntimePlugin,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type SchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { createNativeService, widgetRuntimePlugin } from "@orahako/runtime-native"
import { settingsRegistryPlugin, type PluginSettingsRegistry } from "@orahako/runtime-settings"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import { ToggleGroupItem } from "@orahako/ui-primitives"
import {
  ACADEMIC_POLLING_CAPABILITY,
  AcademicPollingController,
  evaluateNotificationChannels,
  NOTIFICATIONS_CORE_CAPABILITY,
  NOTIFICATIONS_PLUGIN_ID,
  notificationSettingsStore,
  notificationsPlugin,
} from "../src"

function createMemoryStorage(): PluginKeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

function createHarness(options?: { isNative?: boolean }) {
  const localBackend = createMemoryStorage()
  const secureBackend = createMemoryStorage()
  const runtime = new PluginRuntime()
  runtime.context.set(
    "storage",
    new NamespacedStorageService({ local: localBackend, secure: secureBackend })
  )
  runtime.context.set("http", new StatelessHttpService())

  let granted = true
  let tokenValue = "initial-token"
  let pollingConfig: Record<string, unknown> | null = null
  let runNowCalls = 0
  let cancelAllCalls = 0
  let widgetClearCalls = 0

  const requestPermissions = vi.fn(async () => ({ granted }))
  const getAuthToken = vi.fn(async () => tokenValue)

  const invoke = vi.fn(async (id: string, method: string, payload?: Record<string, unknown>) => {
    if (id === ACADEMIC_POLLING_CAPABILITY) {
      if (method === "configure") {
        pollingConfig = { ...payload }
        return { scheduled: true }
      }
      if (method === "stop") {
        pollingConfig = null
        return { stopped: [payload?.handlerId] }
      }
      if (method === "runNow") {
        runNowCalls += 1
        return { queued: true }
      }
      if (method === "inspect") {
        return { state: { active: pollingConfig !== null } }
      }
    }
    if (id === NOTIFICATIONS_CORE_CAPABILITY) {
      if (method === "checkPermissions") return { granted }
      if (method === "requestPermissions") return requestPermissions()
      if (method === "checkBatteryOptimization") return { ignored: true }
      if (method === "requestIgnoreBatteryOptimization") return { ignored: true }
      if (method === "cancelAll") {
        cancelAllCalls += 1
        return { cancelled: true }
      }
    }
    if (id === "widgets.generic@1" && method === "clear") {
      widgetClearCalls += 1
      return { cleared: true }
    }
    return {}
  })

  const nativeService = createNativeService({
    isNative: () => options?.isNative ?? true,
    loadCapabilities: async () => [],
    capabilities: {
      list: () => [
        { id: "notifications.core", version: 1, methods: [] },
        { id: "academic.polling", version: 1, methods: [] },
        { id: "widgets.generic", version: 1, methods: [] },
      ],
      has: () => true,
      acquire: async () => async () => {},
      invoke: invoke as never,
    },
  })
  runtime.context.set("native", nativeService)

  const makeSchoolProvider = (
    id: string,
    handlerId: string,
    supportedPlugins?: readonly string[]
  ): SchoolProvider =>
    defineSchoolProvider({
      id,
      name: `School-${id}`,
      ...(supportedPlugins ? { supportedPlugins } : {}),
      slices: {
        ecard: {
          fetchBalance: async () => ({ ready: true, balance: null }),
        },
        epay: {
          fetchPayments: async () => ({ ready: true, records: [], unpaid: [] }),
          recordStatus: () => "paid",
        },
        nativePolling: {
          handlerId,
          getServerConfig: () => ({ endpoint: `https://${id}.edu` }),
          getAuthToken,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })

  const providersPlugin = definePlugin({
    manifest: {
      id: "test.providers",
      name: "Test Providers",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "provider",
      entry: "index.js",
      inject: ["providers"],
    },
    inject: ["providers"] as const,
    apply(ctx) {
      ctx.providers.registerProvider("campus-a", () => makeSchoolProvider("campus-a", "handler-a"))
      ctx.providers.registerProvider("campus-b", () =>
        makeSchoolProvider("campus-b", "handler-b", ["feature.alpha"])
      )
    },
  })

  for (const p of [
    slotRegistryPlugin,
    settingsRegistryPlugin,
    i18nRegistryPlugin,
    widgetRuntimePlugin,
    providerRegistryRuntimePlugin,
    sessionRuntimePlugin,
    providerRuntimePlugin,
    notificationRegistryRuntimePlugin,
    providersPlugin,
  ]) {
    if (
      p.manifest.id === sessionRuntimePlugin.manifest.id ||
      p.manifest.id === providerRuntimePlugin.manifest.id
    ) {
      runtime.register(p, "builtin", { defaultSchoolId: "campus-a" })
    } else {
      runtime.register(p, "builtin")
    }
    runtime.start(p.manifest.id)
  }

  return {
    runtime,
    invoke,
    getAuthToken,
    requestPermissions,
    setGranted: (next: boolean) => {
      granted = next
    },
    setToken: (next: string) => {
      tokenValue = next
    },
    getPollingConfig: () => pollingConfig,
    getRunNowCalls: () => runNowCalls,
    getCancelAllCalls: () => cancelAllCalls,
    getWidgetClearCalls: () => widgetClearCalls,
  }
}

describe("@orahako/plugin-notifications declarative channels & serialized controller", () => {
  it("computes dynamic polling flags from string and function mappings without hardcoded names", () => {
    const provider = defineSchoolProvider({
      id: "campus-a",
      name: "Campus A",
      slices: {
        ecard: { fetchBalance: async () => ({ ready: true, balance: null }) },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return false
      },
    })

    const plan = evaluateNotificationChannels(
      [
        {
          id: "feed-alpha",
          pluginId: "feature.alpha",
          slice: "ecard",
          toPollingFlag: "pollAlpha",
        },
        {
          id: "feed-beta",
          pluginId: "feature.beta",
          slice: "epay", // missing slice on provider -> inactive!
          toPollingFlag: (enabled) => ({ pollBetaMain: enabled, pollBetaSub: enabled }),
        },
        {
          id: "feed-gamma",
          pluginId: "feature.gamma",
          toPollingFlag: (enabled) => enabled,
        },
      ],
      provider,
      { "feed-gamma": true }
    )

    expect(plan.flags).toEqual({
      pollAlpha: true,
      pollBetaMain: false,
      pollBetaSub: false,
      "feed-gamma": false,
    })
    expect(plan.hasEnabledFlag).toBe(true)
  })

  it("serializes configure/stop/checkNow, invokes channel.onDisable on channel toggle or provider switch, and guards against post-logout races", async () => {
    const harness = createHarness()
    const { runtime } = harness

    const onDisableAlpha = vi.fn()
    const onDisableBeta = vi.fn()
    const onEnableAlpha = vi.fn()
    const onEnableBeta = vi.fn()

    const alphaPlugin = definePlugin({
      manifest: {
        id: "feature.alpha",
        name: "Feature Alpha",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["notifications", "slots"],
      },
      inject: ["notifications", "slots"] as const,
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "feed-alpha",
          slice: "ecard",
          toPollingFlag: "watchAlpha",
          onDisable: onDisableAlpha,
          onEnable: onEnableAlpha,
        })
        ctx.slots.inject("settings.notifications.content", () =>
          ctx.slots.register({ id: "alpha-opt", slot: "settings.notifications.content" }, () => (
            <ToggleGroupItem value="feed-alpha">Alpha</ToggleGroupItem>
          ))
        )
      },
    })

    const betaPlugin = definePlugin({
      manifest: {
        id: "feature.beta",
        name: "Feature Beta",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["notifications"],
      },
      inject: ["notifications"] as const,
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "feed-beta",
          slice: "epay",
          toPollingFlag: (enabled) => ({ watchBeta: enabled }),
          onDisable: onDisableBeta,
          onEnable: onEnableBeta,
        })
      },
    })

    runtime.register(notificationsPlugin, "builtin")
    runtime.register(alphaPlugin, "builtin")
    runtime.register(betaPlugin, "builtin")
    runtime.start(NOTIFICATIONS_PLUGIN_ID)
    runtime.start(alphaPlugin.manifest.id)
    runtime.start(betaPlugin.manifest.id)

    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService

    slots.declare({ name: "debug.panels", kind: "list" })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "campus-a",
      credential: "ticket-a",
      username: "student-1",
    })
    await providerRuntime.initialize()
    await vi.waitFor(() => {
      expect(onEnableAlpha).toHaveBeenCalledTimes(1)
      expect(onEnableBeta).toHaveBeenCalledTimes(1)
    })

    const category = settings.getSnapshot().find((c) => c.id === "notifications")!
    expect(category).toBeDefined()
    expect(slots.select("debug.panels")).toHaveLength(1)

    const store = category.store as ReturnType<typeof notificationSettingsStore.create>
    await vi.waitFor(() => expect(store.hydrated.getSnapshot()).toBe(true))

    // Enable polling + coalesce rapid mutations
    store.actions.setEnabled(true)
    store.actions.setCheckInterval(45)
    store.actions.setNotifyNetworkError(true)

    await vi.waitFor(() => {
      expect(harness.getPollingConfig()).toMatchObject({
        handlerId: "handler-a",
        intervalMinutes: 45,
        payload: expect.objectContaining({
          providerId: "campus-a",
          castgc: "initial-token",
          watchAlpha: true,
          watchBeta: true,
          notifyNetworkError: true,
        }),
      })
    })
    expect(harness.getRunNowCalls()).toBeGreaterThanOrEqual(1)

    // Render settings category & debug panel cleanly via ContributionOutlet
    const categoryHtml = renderToStaticMarkup(
      <ContributionOutlet entry={category} slots={slots} i18n={i18n} />
    )
    expect(categoryHtml).toContain("后台动态通知")
    expect(categoryHtml).toContain("Alpha")

    const debugEntry = slots.select("debug.panels")[0]!
    const debugHtml = renderToStaticMarkup(
      <ContributionOutlet entry={debugEntry} slots={slots} i18n={i18n} />
    )
    expect(debugHtml).toContain("feed-alpha")

    // Disabling feed-alpha triggers onDisableAlpha and clears widgets
    store.actions.setChannelEnabled("feed-alpha", false)
    expect(onDisableAlpha).toHaveBeenCalledTimes(1)
    expect(onEnableAlpha).toHaveBeenCalledTimes(1)
    expect(harness.getWidgetClearCalls()).toBeGreaterThanOrEqual(1)

    await vi.waitFor(() => {
      expect(harness.getPollingConfig()).toMatchObject({
        payload: expect.objectContaining({
          watchAlpha: false,
          watchBeta: true,
        }),
      })
    })

    // Re-enabling feed-alpha fires onEnableAlpha and restores the polling flag
    store.actions.setChannelEnabled("feed-alpha", true)
    expect(onEnableAlpha).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => {
      expect(harness.getPollingConfig()).toMatchObject({
        payload: expect.objectContaining({
          watchAlpha: true,
          watchBeta: true,
        }),
      })
    })

    // Relogin refreshes expired token cleanly
    session.setSessionExpired(true)
    await vi.waitFor(() => expect(harness.getPollingConfig()).toBeNull())
    harness.setToken("renewed-token")
    session.setSessionExpired(false)

    await vi.waitFor(() => {
      expect(harness.getPollingConfig()).toMatchObject({
        handlerId: "handler-a",
        payload: expect.objectContaining({
          castgc: "renewed-token",
        }),
      })
    })

    // Switching provider triggers onDisable/onEnable on previously active channels and switches handlerId
    session.setCredential({
      schoolId: "campus-b",
      credential: "ticket-b",
      username: "student-2",
    })
    providerRuntime.selectSchool("campus-b")
    await providerRuntime.initialize()

    expect(onDisableBeta).toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(harness.getPollingConfig()).toMatchObject({
        handlerId: "handler-b",
        payload: expect.objectContaining({
          providerId: "campus-b",
          watchAlpha: true,
          watchBeta: false, // feature.beta is excluded by campus-b supportedPlugins!
        }),
      })
    })

    // Token lookup finishing AFTER logout cannot resurrect polling
    const deferredToken = Promise.withResolvers<string>()
    const lookupStarted = Promise.withResolvers<void>()
    harness.getAuthToken.mockImplementationOnce(() => {
      lookupStarted.resolve()
      return deferredToken.promise
    })

    const standaloneStore = notificationSettingsStore.create()
    standaloneStore.actions.setEnabled(true)
    const standaloneController = new AcademicPollingController({
      store: standaloneStore,
      notifications: runtime.context.get("notifications")!,
      provider: providerRuntime,
      session,
      native: runtime.context.get("native")!,
      widgets: runtime.context.get("widgets")!,
      loadCapabilities: async () => [],
    })

    await lookupStarted.promise
    const stopPromise = standaloneController.stopAll()
    session.clearCredential("campus-b")
    deferredToken.resolve("late-token")
    await stopPromise
    await standaloneController.sync()

    expect(harness.getPollingConfig()).toBeNull()
    await standaloneController.dispose()
    standaloneStore.dispose()

    // Stopping notificationsPlugin tears down category, child slot declarations & debug contribution
    runtime.stop(NOTIFICATIONS_PLUGIN_ID)
    expect(settings.getSnapshot()).toEqual([])
    expect(slots.select("settings.notifications.content")).toEqual([])
    expect(slots.select("debug.panels")).toEqual([])

    runtime.dispose()
  })
})
