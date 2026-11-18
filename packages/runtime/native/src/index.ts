import {
  createWidgetService,
  definePlugin,
  isCapacitor,
  loadNativeCapabilities,
  nativeCapabilities,
  PLUGIN_API_VERSION,
  type PluginNativeCapabilityService,
  type PluginNativeService,
} from "@orahako/sdk"

export { createWidgetService }

export const NATIVE_FILES_CAPABILITY = "native.files@1"
export const NOTIFICATIONS_CORE_CAPABILITY = "notifications.core@1"

export interface NativeServiceOptions {
  readonly isNative?: () => boolean
  readonly capabilities?: PluginNativeCapabilityService
  readonly loadCapabilities?: () => Promise<unknown>
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const slice = bytes.subarray(offset, offset + chunkSize)
    for (let i = 0; i < slice.length; i++) {
      binary += String.fromCharCode(slice[i]!)
    }
  }
  return btoa(binary)
}

export function createNativeService(options: NativeServiceOptions = {}): PluginNativeService {
  const checkNative = options.isNative ?? isCapacitor
  const capabilities = options.capabilities ?? nativeCapabilities
  const ensureLoaded = options.loadCapabilities ?? loadNativeCapabilities

  const callNotifications = async <T>(
    method: string,
    payload: Record<string, unknown> = {}
  ): Promise<T | undefined> => {
    if (!checkNative()) return undefined
    await ensureLoaded()
    if (!capabilities.has(NOTIFICATIONS_CORE_CAPABILITY)) return undefined
    return capabilities.invoke<T>(NOTIFICATIONS_CORE_CAPABILITY, method, payload)
  }

  return {
    get isNative(): boolean {
      return checkNative()
    },
    capabilities,
    async saveImage(image: Blob, fileName?: string): Promise<{ uri: string }> {
      const bytes = new Uint8Array(await image.arrayBuffer())
      return capabilities.invoke<{ uri: string }>(NATIVE_FILES_CAPABILITY, "saveImageToGallery", {
        base64: encodeBytesToBase64(bytes),
        mimeType: image.type,
        ...(fileName !== undefined ? { fileName } : {}),
      })
    },
    async requestNotificationPermission(): Promise<boolean> {
      if (checkNative()) {
        const current = await callNotifications<{ granted?: boolean }>("checkPermissions")
        if (current?.granted === true) return true
        const requested = await callNotifications<{ granted?: boolean }>("requestPermissions")
        return requested?.granted === true
      }
      if (typeof Notification === "undefined") return false
      if (Notification.permission === "granted") return true
      if (Notification.permission === "denied") return false
      return (await Notification.requestPermission()) === "granted"
    },
    async requestExactAlarmPermission(): Promise<boolean> {
      if (!checkNative()) return false
      const current = await callNotifications<{ granted?: boolean }>("checkExactAlarmPermission")
      if (current?.granted === true) return true
      const requested = await callNotifications<{ granted?: boolean }>(
        "requestExactAlarmPermission"
      )
      return requested?.granted === true
    },
    async requestBatteryOptimizationExemption(): Promise<boolean> {
      if (!checkNative()) return false
      const current = await callNotifications<{ ignored?: boolean }>("checkBatteryOptimization")
      if (current?.ignored === true) return true
      const requested = await callNotifications<{ ignored?: boolean }>(
        "requestIgnoreBatteryOptimization"
      )
      return requested?.ignored === true
    },
  }
}

export const nativeRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.native",
    name: "Capacitor native capabilities",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["native"],
  },
  async apply(ctx) {
    const service = createNativeService()
    if (service.isNative) {
      await loadNativeCapabilities().catch(() => {
        // Capability resolution errors surface when consumers acquire or invoke them.
      })
    }
    ctx.set("native", service)
  },
})

export const widgetRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.widgets",
    name: "Native home-screen widgets",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    inject: ["native"],
    provides: ["widgets"],
  },
  inject: ["native"] as const,
  apply(ctx) {
    ctx.set("widgets", createWidgetService(ctx.native))
  },
})
