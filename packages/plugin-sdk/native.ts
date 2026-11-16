/**
 * Public platform and native-capability bridge.
 *
 * The bridge only knows `describe` / `acquire` / `release` / `invoke` and a
 * capability-scoped event stream. Which capabilities exist and how they are
 * configured is decided by the native build composition.
 *
 * Plugin code should normally consume the scoped `PluginContext.native`
 * service. The exported bridge is the host-side capability API used to build
 * that service and to prefetch descriptors; it is not a hidden global default
 * for plugin operations.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"
import type {
  NativeCapabilityDescriptor,
  PluginNativeCapabilityService,
} from "./services"

/** Detects whether the app runs inside a Capacitor native shell. */
export function isCapacitor(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** Tablets have a shorter screen edge >= 600 CSS pixels (covers budget tablets). */
export function isTablet(): boolean {
  if (typeof window === "undefined") return false
  const shortEdge = Math.min(window.screen.width, window.screen.height)
  return shortEdge >= 600
}

export interface NativeCapabilityEvent {
  readonly capabilityId: string
  readonly event: string
  readonly data: Record<string, unknown>
}

export interface NativeCapabilityLease {
  readonly token: string
  readonly id: string
  readonly version: number
  readonly dependencies: readonly string[]
}

export interface OrahakoNativePlugin {
  describe(): Promise<{ capabilities: NativeCapabilityDescriptor[] }>
  acquire(options: { id: string }): Promise<NativeCapabilityLease>
  release(options: { token: string }): Promise<{ released: boolean }>
  invoke<T = Record<string, unknown>>(options: {
    id: string
    method: string
    payload?: Record<string, unknown>
  }): Promise<T>
  addListener(
    eventName: "capabilityEvent",
    listener: (event: NativeCapabilityEvent) => void
  ): Promise<PluginListenerHandle>
}

const WEB_UNSUPPORTED = "Native capabilities are unavailable outside the Android app"

const webImplementation: OrahakoNativePlugin = {
  async describe() {
    return { capabilities: [] }
  },
  async acquire() {
    throw new Error(WEB_UNSUPPORTED)
  },
  async release() {
    return { released: false }
  },
  async invoke<T>(): Promise<T> {
    throw new Error(WEB_UNSUPPORTED)
  },
  async addListener(): Promise<PluginListenerHandle> {
    return { remove: async () => {} }
  },
}

export const NativeCompanion = registerPlugin<OrahakoNativePlugin>("OrahakoNative", {
  web: () => Promise.resolve(webImplementation),
})

let cachedDescriptors: NativeCapabilityDescriptor[] = []
let describePromise: Promise<readonly NativeCapabilityDescriptor[]> | null = null

/** Loads and caches the native capability list; safe to call repeatedly. */
export function loadNativeCapabilities(): Promise<readonly NativeCapabilityDescriptor[]> {
  if (!describePromise) {
    describePromise = NativeCompanion.describe()
      .then(({ capabilities }) => {
        cachedDescriptors = capabilities
        return cachedDescriptors
      })
      .catch((error: unknown) => {
        describePromise = null
        throw error
      })
  }
  return describePromise
}

function findCapability(reference: string): NativeCapabilityDescriptor | undefined {
  const separator = reference.lastIndexOf("@")
  const id = separator > 0 ? reference.slice(0, separator) : reference
  const version =
    separator > 0 && separator < reference.length - 1
      ? Number(reference.slice(separator + 1))
      : undefined
  return cachedDescriptors.find(
    (descriptor) =>
      descriptor.id === id && (version === undefined || descriptor.version === version)
  )
}

/**
 * SDK-facing capability service. `list` and `has` read the cache loaded at
 * startup; `acquire` and `invoke` await the describe call when necessary.
 */
export const nativeCapabilities: PluginNativeCapabilityService = {
  list(): readonly NativeCapabilityDescriptor[] {
    return cachedDescriptors
  },
  has(id: string): boolean {
    return findCapability(id) !== undefined
  },
  async acquire(id: string, config?: Record<string, unknown>): Promise<() => Promise<void>> {
    await loadNativeCapabilities()
    if (!findCapability(id)) throw new Error(`Unknown native capability: ${id}`)
    if (config && Object.keys(config).length > 0) {
      throw new Error(`Native capability config is fixed by the build composition: ${id}`)
    }
    const lease = await NativeCompanion.acquire({ id })
    let released = false
    return async () => {
      if (released) return
      released = true
      await NativeCompanion.release({ token: lease.token })
    }
  },
  async invoke<T>(id: string, method: string, payload?: Record<string, unknown>): Promise<T> {
    await loadNativeCapabilities()
    if (!findCapability(id)) throw new Error(`Unknown native capability: ${id}`)
    return NativeCompanion.invoke<T>({ id, method, payload })
  },
}

export async function invokeNativeCapability<T = Record<string, unknown>>(
  id: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<T> {
  return nativeCapabilities.invoke<T>(id, method, payload)
}

/** Subscribes to one capability event; unrelated events are filtered out. */
export async function onNativeCapabilityEvent<T = Record<string, unknown>>(
  capabilityId: string,
  event: string,
  listener: (data: T) => void
): Promise<PluginListenerHandle> {
  return NativeCompanion.addListener("capabilityEvent", (payload) => {
    if (payload.capabilityId === capabilityId && payload.event === event) {
      listener(payload.data as T)
    }
  })
}

if (isCapacitor()) {
  void loadNativeCapabilities().catch(() => {
    // Composition failures surface through explicit acquire/invoke calls.
  })
}
