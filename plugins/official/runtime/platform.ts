import {
  definePlugin,
  invokeNativeCapability,
  isCapacitor,
  nativeCapabilities,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type CompositionPlugin,
  type PluginHttpService,
  type PluginManifest,
  type PluginNativeService,
} from "@orahako/plugin-sdk"
import type { Context } from "@cordisjs/core"
import { fetchStateless, type ActivationTokenSource } from "./http/cookie"
import { NetworkActivityRuntime } from "./http/activity"
import {
  checkBatteryOptimization,
  checkExactAlarmPermission,
  requestBatteryOptimizationExemption,
  requestExactAlarmPermission,
  requestNotificationPermission,
} from "@/plugins/official/runtime/native/notify"

export class StatelessHttpService {
  private readonly activity = new NetworkActivityRuntime()

  constructor(private readonly activation?: ActivationTokenSource) {}

  /** Releases this service's activity listeners and provider registrations. */
  dispose(): void {
    this.activity.dispose()
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context): PluginHttpService {
    return {
      send: (request) => fetchStateless(request, this.activity, this.activation),
      activity: {
        getSnapshot: () => this.activity.getSnapshot(),
        beginRequest: (url, method) => this.activity.beginRequest(url, method),
        subscribe: (listener) =>
          trackPluginRegistration(ctx, () => this.activity.subscribe(listener)),
        registerLabeler: (labeler) =>
          trackPluginRegistration(ctx, () => this.activity.registerLabeler(labeler)),
        registerClassifier: (classifier) =>
          trackPluginRegistration(ctx, () => this.activity.registerClassifier(classifier)),
      },
    }
  }
}

const nativeService: PluginNativeService = {
  isNative: isCapacitor(),
  capabilities: nativeCapabilities,
  saveImage: async (image, fileName) => {
    const bytes = new Uint8Array(await image.arrayBuffer())
    let binary = ""
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return invokeNativeCapability<{ uri: string }>("native.files", "saveImageToGallery", {
      base64: btoa(binary),
      mimeType: image.type,
      fileName,
    })
  },
  requestNotificationPermission: async () => {
    if (isCapacitor()) return requestNotificationPermission()
    if (typeof Notification === "undefined") return false
    if (Notification.permission === "granted") return true
    if (Notification.permission === "denied") return false
    return (await Notification.requestPermission()) === "granted"
  },
  requestExactAlarmPermission: async () => {
    if (!isCapacitor()) return false
    const current = await checkExactAlarmPermission()
    return current.granted || (await requestExactAlarmPermission()).granted
  },
  requestBatteryOptimizationExemption: async () => {
    if (!isCapacitor()) return false
    if ((await checkBatteryOptimization()).ignored) return true
    return requestBatteryOptimizationExemption()
  },
}

const httpManifest: PluginManifest = {
  id: "orahako.runtime.http",
  name: "Stateless platform HTTP",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "runtime",
  entry: "index.js",
  provides: ["http"],
}

/**
 * Builds the HTTP runtime with the composition-owned activation credential
 * source. Transport code never reads a shell store directly.
 */
export function createHttpRuntimePlugin(
  activation?: ActivationTokenSource
): CompositionPlugin {
  return {
    manifest: httpManifest,
    definition: definePlugin((ctx) => {
      const service = new StatelessHttpService(activation)
      ctx.on("dispose", () => service.dispose())
      ctx.set("http", service)
    }),
  }
}

/** Default transport without web activation wiring; compositions may add it. */
export const httpRuntimePlugin: CompositionPlugin = createHttpRuntimePlugin()

export const nativeRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.native",
    name: "Capacitor native capabilities",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["native"],
  },
  definition: definePlugin((ctx) => {
    ctx.set("native", nativeService)
  }),
}
