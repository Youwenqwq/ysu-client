import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const companionMocks = vi.hoisted(() => ({
  isNative: false,
  describe: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  invoke: vi.fn(),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
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
  definePlugin,
  PLUGIN_API_VERSION,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  type NativeCapabilityDescriptor,
  type PluginNativeCapabilityService,
  type PluginNativeService,
  type PluginWidgetService,
} from "@orahako/sdk"
import {
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
})
