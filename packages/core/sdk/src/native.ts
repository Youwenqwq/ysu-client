import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core"

export interface NativeCapabilityDescriptor {
  readonly id: string
  readonly version: number
  readonly methods: readonly string[]
  readonly config?: Readonly<Record<string, unknown>>
}

export interface PluginNativeCapabilityService {
  list(): readonly NativeCapabilityDescriptor[]
  has(id: string): boolean
  acquire(id: string, config?: Record<string, unknown>): Promise<() => Promise<void>>
  invoke<T>(id: string, method: string, payload?: Record<string, unknown>): Promise<T>
}

export interface PluginNativeService {
  readonly isNative: boolean
  readonly capabilities: PluginNativeCapabilityService
  saveImage(image: Blob, fileName?: string): Promise<{ uri: string }>
  requestNotificationPermission(): Promise<boolean>
  requestExactAlarmPermission(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<boolean>
}

export type NotificationImportance = "none" | "min" | "low" | "default" | "high" | "max"
export type NotificationVisibility = "public" | "private" | "secret"
export type NotificationCategory =
  | "reminder"
  | "event"
  | "alarm"
  | "error"
  | "message"
  | "progress"
  | "status"

export interface NativeNotificationChannelSpec {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly importance?: NotificationImportance
  readonly sound?: boolean
  readonly vibration?: boolean
  readonly showBadge?: boolean
  readonly lockscreenVisibility?: NotificationVisibility
}

export interface NativeNotificationChannelStatus {
  readonly id: string
  readonly exists: boolean
  readonly name?: string | null
  readonly importance?: number | null
  readonly soundEnabled?: boolean | null
  readonly vibrationEnabled?: boolean | null
  readonly showBadge?: boolean | null
  readonly lockscreenVisibility?: number | null
  readonly blocked: boolean
}

export interface NativeLocalNotificationSpec {
  readonly channelId: string
  readonly title: string
  readonly body: string
  readonly bigText?: string
  readonly id?: number
  readonly tag?: string
  readonly deepLink?: string
  readonly category?: NotificationCategory
  readonly priority?: Exclude<NotificationImportance, "none">
  readonly autoCancel?: boolean
  readonly onlyAlertOnce?: boolean
  readonly silent?: boolean
  readonly visibility?: NotificationVisibility
  readonly ongoing?: boolean
}

export interface NativeCalendarEventSpec {
  readonly uid: string
  readonly title: string
  readonly location?: string
  readonly description?: string
  readonly startAt: number
  readonly endAt: number
  readonly remindMinutes?: number
}

export interface NativeCalendarSyncResult {
  readonly namespace: string
  readonly synced: number
  readonly created: number
  readonly updated: number
  readonly deleted: number
  readonly calendarId: number
  readonly dedicated: boolean
}

const NOTIFICATIONS_CORE_ID = "notifications.core@1"
const CALENDAR_SYNC_ID = "calendar.sync@1"
const BACKGROUND_TASKS_ID = "background.tasks@1"

export type BackgroundTaskOutcome = "success" | "retry" | "skipped"

export interface BackgroundHttpRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly followRedirects?: boolean
  readonly timeoutMs?: number
  readonly responseType?: "text" | "base64"
}

export interface BackgroundHttpResponse {
  readonly status: number
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly setCookies: readonly string[]
  readonly body: string
}

export interface BackgroundTaskContext {
  readonly pluginId: string
  readonly taskId: string
  readonly http: {
    send(request: BackgroundHttpRequest): Promise<BackgroundHttpResponse>
  }
  readonly storage: {
    getItem(key: string): Promise<string | null>
    setItem(key: string, value: string): Promise<void>
    removeItem(key: string): Promise<void>
  }
  readonly notifications: {
    ensureChannel(spec: NativeNotificationChannelSpec): Promise<boolean>
    post(spec: NativeLocalNotificationSpec): Promise<{ id: number; tag?: string | null; posted: boolean }>
    cancel(target: { readonly id?: number; readonly tag?: string; readonly channelId?: string }): Promise<number>
  }
  readonly state: {
    setDiagnostics(snapshot: Record<string, unknown>): Promise<void>
  }
}

export type BackgroundTaskHandler<TPayload = Record<string, unknown>> = (
  ctx: BackgroundTaskContext,
  payload: TPayload
) => Promise<BackgroundTaskOutcome | void> | BackgroundTaskOutcome | void

/**
 * Registers a headless QuickJS background task handler inside a plugin's
 * standalone `background` bundle.
 */
export function defineBackgroundTask<TPayload = Record<string, unknown>>(
  handler: BackgroundTaskHandler<TPayload>
): BackgroundTaskHandler<TPayload> {
  const target = globalThis as Record<string, unknown>
  target.__orahakoBackgroundTask = handler
  return handler
}

export interface BackgroundTaskRegistration {
  readonly taskId: string
  readonly pluginId: string
  readonly script: string
  readonly intervalMinutes?: number
  readonly requiresNetwork?: boolean
  readonly timeoutMs?: number
  readonly payload?: Record<string, unknown>
}

export async function registerBackgroundTask(
  native: PluginNativeService,
  registration: BackgroundTaskRegistration
): Promise<{ taskId: string; pluginId: string; intervalMinutes: number; scheduled: boolean } | null> {
  if (!native.isNative || !native.capabilities.has(BACKGROUND_TASKS_ID)) return null
  return native.capabilities.invoke(BACKGROUND_TASKS_ID, "register", { ...registration })
}

export async function unregisterBackgroundTask(
  native: PluginNativeService,
  taskId?: string
): Promise<readonly string[]> {
  if (!native.isNative || !native.capabilities.has(BACKGROUND_TASKS_ID)) return []
  const result = await native.capabilities.invoke<{ unregistered?: readonly string[] }>(
    BACKGROUND_TASKS_ID,
    "unregister",
    taskId ? { taskId } : {}
  )
  return result?.unregistered ?? []
}

export async function runBackgroundTaskNow(
  native: PluginNativeService,
  taskId: string
): Promise<boolean> {
  if (!native.isNative || !native.capabilities.has(BACKGROUND_TASKS_ID)) return false
  const result = await native.capabilities.invoke<{ queued?: boolean }>(
    BACKGROUND_TASKS_ID,
    "runNow",
    { taskId }
  )
  return result?.queued === true
}

export async function inspectBackgroundTask(
  native: PluginNativeService,
  taskId: string
): Promise<Record<string, unknown> | null> {
  if (!native.isNative || !native.capabilities.has(BACKGROUND_TASKS_ID)) return null
  const result = await native.capabilities.invoke<{ state?: Record<string, unknown> }>(
    BACKGROUND_TASKS_ID,
    "inspect",
    { taskId }
  )
  return result?.state ?? null
}

export async function clearPluginBackgroundTasks(
  native: PluginNativeService,
  pluginId: string
): Promise<readonly string[]> {
  if (!native.isNative || !native.capabilities.has(BACKGROUND_TASKS_ID)) return []
  const result = await native.capabilities.invoke<{ clearedTasks?: readonly string[] }>(
    BACKGROUND_TASKS_ID,
    "clearPlugin",
    { pluginId }
  )
  return result?.clearedTasks ?? []
}

export async function ensureNotificationChannel(
  native: PluginNativeService,
  spec: NativeNotificationChannelSpec
): Promise<{ id: string; created: boolean } | null> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return null
  return native.capabilities.invoke<{ id: string; created: boolean }>(
    NOTIFICATIONS_CORE_ID,
    "ensureChannel",
    { ...spec }
  )
}

export async function ensureNotificationChannels(
  native: PluginNativeService,
  channels: readonly NativeNotificationChannelSpec[]
): Promise<readonly { id: string; created: boolean }[]> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return []
  const result = await native.capabilities.invoke<{
    channels?: readonly { id: string; created: boolean }[]
  }>(NOTIFICATIONS_CORE_ID, "ensureChannels", { channels })
  return result?.channels ?? []
}

export async function getNotificationChannelStatus(
  native: PluginNativeService,
  channelId: string
): Promise<NativeNotificationChannelStatus | null> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return null
  return native.capabilities.invoke<NativeNotificationChannelStatus>(
    NOTIFICATIONS_CORE_ID,
    "getChannelStatus",
    { id: channelId }
  )
}

export async function openNotificationSettings(
  native: PluginNativeService,
  channelId?: string
): Promise<boolean> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return false
  const result = await native.capabilities.invoke<{ opened?: boolean }>(
    NOTIFICATIONS_CORE_ID,
    "openNotificationSettings",
    channelId ? { channelId } : {}
  )
  return result?.opened === true
}

export async function postLocalNotification(
  native: PluginNativeService,
  spec: NativeLocalNotificationSpec
): Promise<{ id: number; tag?: string | null; posted: boolean } | null> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return null
  return native.capabilities.invoke<{ id: number; tag?: string | null; posted: boolean }>(
    NOTIFICATIONS_CORE_ID,
    "post",
    { ...spec }
  )
}

export async function cancelLocalNotification(
  native: PluginNativeService,
  target: { readonly id?: number; readonly tag?: string; readonly channelId?: string }
): Promise<number> {
  if (!native.isNative || !native.capabilities.has(NOTIFICATIONS_CORE_ID)) return 0
  const result = await native.capabilities.invoke<{ cancelled?: number }>(
    NOTIFICATIONS_CORE_ID,
    "cancel",
    { ...target }
  )
  return result?.cancelled ?? 0
}

export async function syncCalendarNamespace(
  native: PluginNativeService,
  options: {
    readonly namespace: string
    readonly events: readonly NativeCalendarEventSpec[]
    readonly timeZone?: string
    readonly calendarName?: string
  }
): Promise<NativeCalendarSyncResult | null> {
  if (!native.isNative || !native.capabilities.has(CALENDAR_SYNC_ID)) return null
  return native.capabilities.invoke<NativeCalendarSyncResult>(CALENDAR_SYNC_ID, "sync", {
    ...options,
  })
}

export async function upsertCalendarEvents(
  native: PluginNativeService,
  options: {
    readonly namespace: string
    readonly events: readonly NativeCalendarEventSpec[]
    readonly timeZone?: string
    readonly calendarName?: string
  }
): Promise<NativeCalendarSyncResult | null> {
  if (!native.isNative || !native.capabilities.has(CALENDAR_SYNC_ID)) return null
  return native.capabilities.invoke<NativeCalendarSyncResult>(CALENDAR_SYNC_ID, "upsert", {
    ...options,
  })
}

export async function removeCalendarEvents(
  native: PluginNativeService,
  namespace: string,
  uids: readonly string[]
): Promise<number> {
  if (!native.isNative || !native.capabilities.has(CALENDAR_SYNC_ID)) return 0
  const result = await native.capabilities.invoke<{ deleted?: number }>(
    CALENDAR_SYNC_ID,
    "remove",
    { namespace, uids }
  )
  return result?.deleted ?? 0
}

export async function clearCalendarNamespace(
  native: PluginNativeService,
  namespace: string
): Promise<boolean> {
  if (!native.isNative || !native.capabilities.has(CALENDAR_SYNC_ID)) return false
  const result = await native.capabilities.invoke<{ cleared?: boolean }>(
    CALENDAR_SYNC_ID,
    "clear",
    { namespace }
  )
  return result?.cleared === true
}

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
