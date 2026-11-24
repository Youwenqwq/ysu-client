import {
  getSlice,
  hasSlice,
  supportsPlugin,
  type AcademicNotificationChannel,
  type AcademicNotificationService,
  type NativePollingSlice,
  type ProviderRuntimeService,
  type SchoolProvider,
  type SessionService,
} from "@orahako/academic-sdk"
import {
  loadNativeCapabilities,
  type PluginNativeService,
  type PluginWidgetService,
} from "@orahako/sdk"
import type { NotificationSettingsStoreInstance } from "./store"

export const NOTIFICATIONS_CORE_CAPABILITY = "notifications.core@1"
export const ACADEMIC_POLLING_CAPABILITY = "academic.polling@1"

export interface EvaluatedNotificationChannel {
  readonly channel: AcademicNotificationChannel
  readonly supported: boolean
  readonly userEnabled: boolean
  readonly active: boolean
  readonly participatesInPolling: boolean
}

export interface ComputedPollingPlan {
  readonly channels: readonly EvaluatedNotificationChannel[]
  readonly flags: Readonly<Record<string, boolean>>
  readonly hasEnabledFlag: boolean
}

export function evaluateNotificationChannels(
  channels: readonly AcademicNotificationChannel[],
  provider: SchoolProvider | null,
  disabledChannels: Readonly<Record<string, boolean>>
): ComputedPollingPlan {
  const evaluated: EvaluatedNotificationChannel[] = []
  const flags: Record<string, boolean> = {}

  for (const channel of channels) {
    const supported =
      provider !== null &&
      supportsPlugin(provider.supportedPlugins, channel.pluginId) &&
      (channel.slice === undefined || hasSlice(provider, channel.slice))
    const userEnabled = disabledChannels[channel.id] !== true
    const active = supported && userEnabled
    const participatesInPolling = channel.toPollingFlag !== undefined

    evaluated.push({
      channel,
      supported,
      userEnabled,
      active,
      participatesInPolling,
    })

    const mapping = channel.toPollingFlag
    if (mapping === undefined) continue
    if (typeof mapping === "string") {
      flags[mapping] = active
    } else {
      const mapped = mapping(active)
      if (typeof mapped === "boolean") {
        flags[channel.id] = mapped
      } else {
        for (const [flagKey, flagValue] of Object.entries(mapped)) {
          flags[flagKey] = Boolean(flagValue)
        }
      }
    }
  }

  const hasEnabledFlag = Object.values(flags).some(Boolean)
  return {
    channels: evaluated,
    flags,
    hasEnabledFlag,
  }
}

export function hashNotifyAccount(providerId: string, username: string): string {
  let hash = 2166136261
  const input = `${providerId}:${username}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

function stableFlagsEntries(
  flags: Readonly<Record<string, boolean>>
): ReadonlyArray<readonly [string, boolean]> {
  return Object.keys(flags)
    .sort()
    .map((key) => [key, Boolean(flags[key])] as const)
}

async function readPollingToken(slice: NativePollingSlice): Promise<string | undefined> {
  try {
    return (await slice.getAuthToken()) ?? undefined
  } catch {
    return undefined
  }
}

export interface AcademicPollingControllerOptions {
  readonly store: NotificationSettingsStoreInstance
  readonly notifications: AcademicNotificationService
  readonly provider: ProviderRuntimeService
  readonly session: SessionService
  readonly native: PluginNativeService
  readonly widgets: PluginWidgetService
  readonly loadCapabilities?: () => Promise<unknown>
}

export class AcademicPollingController {
  private readonly store: NotificationSettingsStoreInstance
  private readonly notifications: AcademicNotificationService
  private readonly provider: ProviderRuntimeService
  private readonly session: SessionService
  private readonly native: PluginNativeService
  private readonly widgets: PluginWidgetService
  private readonly ensureCapabilitiesLoaded: () => Promise<unknown>

  private nativeQueue: Promise<void> = Promise.resolve()
  private pollingSync: Promise<void> = Promise.resolve()
  private pollingRevision = 0
  private lifecycleRevision = 0
  private permissionRevision = 0
  private stopped = false
  private disposed = false
  private lastPollingHash = ""
  private lastBoundHandlerId: string | undefined
  private pendingTokenRefresh = false
  private pendingCheck = false

  private previousProviderId: string | null = null
  private previousActiveChannels = new Map<string, AcademicNotificationChannel>()
  private previousSessionSnapshot: {
    isAuthenticated: boolean
    username: string | null
    credential: string | null
    sessionExpired: boolean
    hasHydrated: boolean
  }
  private previousStoreEnabled: boolean
  private readonly unsubscribers: Array<() => void> = []

  constructor(options: AcademicPollingControllerOptions) {
    this.store = options.store
    this.notifications = options.notifications
    this.provider = options.provider
    this.session = options.session
    this.native = options.native
    this.widgets = options.widgets
    this.ensureCapabilitiesLoaded = options.loadCapabilities ?? loadNativeCapabilities

    const initialSession = this.session.getSnapshot()
    this.stopped = !initialSession.isAuthenticated
    this.previousSessionSnapshot = {
      isAuthenticated: initialSession.isAuthenticated,
      username: initialSession.username,
      credential: initialSession.credential,
      sessionExpired: initialSession.sessionExpired,
      hasHydrated: initialSession.hasHydrated,
    }
    this.previousStoreEnabled = this.store.source.getSnapshot().enabled

    this.attachSubscriptions()
    this.reconcileChannels()
    void this.sync()
  }

  getPlan(): ComputedPollingPlan {
    return evaluateNotificationChannels(
      this.notifications.getSnapshot(),
      this.provider.getSnapshot().provider,
      this.store.source.getSnapshot().disabledChannels
    )
  }

  resolveHandlerId(): string | undefined {
    const activeProvider = this.provider.getSnapshot().provider
    if (!activeProvider) return undefined
    const pollingSlice = getSlice(activeProvider, "nativePolling")
    if (!pollingSlice) return undefined
    return pollingSlice.handlerId ?? activeProvider.id
  }

  async checkNotificationPermission(): Promise<boolean> {
    const result = await this.callNotifications<{ granted?: boolean }>("checkPermissions")
    return result?.granted === true
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (await this.checkNotificationPermission()) return true
    const result = await this.callNotifications<{ granted?: boolean }>("requestPermissions")
    return result?.granted === true
  }

  async checkBatteryOptimization(): Promise<boolean | null> {
    if (!this.native.isNative) return null
    const result = await this.callNotifications<{ ignored?: boolean }>("checkBatteryOptimization")
    if (!result) return null
    return result.ignored === true
  }

  async inspect(): Promise<Record<string, unknown> | null> {
    const handlerId = this.resolveHandlerId() ?? this.lastBoundHandlerId
    if (!handlerId) return null
    const result = await this.callPolling<{ state?: Record<string, unknown> }>("inspect", {
      handlerId,
    })
    return result?.state ?? null
  }

  sync(options: { checkNow?: boolean; refreshToken?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const revision = ++this.pollingRevision
    this.pendingTokenRefresh ||= options.refreshToken === true
    this.pendingCheck ||= options.checkNow === true

    this.pollingSync = this.enqueueNative(async () => {
      if (this.disposed || !this.native.isNative || revision !== this.pollingRevision) return

      const sessionSnap = this.session.getSnapshot()
      const storeHydrated = this.store.hydrated.getSnapshot()
      if (!sessionSnap.hasHydrated || !storeHydrated) return

      const settings = this.store.source.getSnapshot()
      const activeProvider = this.provider.getSnapshot().provider
      const pollingSlice = getSlice(activeProvider, "nativePolling")
      const providerId = activeProvider?.id
      const handlerId = pollingSlice ? (pollingSlice.handlerId ?? activeProvider?.id) : undefined
      const plan = evaluateNotificationChannels(
        this.notifications.getSnapshot(),
        activeProvider,
        settings.disabledChannels
      )

      const isValid = (): boolean =>
        !this.disposed &&
        revision === this.pollingRevision &&
        !this.stopped &&
        this.session.getSnapshot().isAuthenticated

      if (
        !isValid() ||
        (!settings.enabled && !this.pendingTokenRefresh) ||
        (!plan.hasEnabledFlag && !settings.notifyNetworkError) ||
        sessionSnap.sessionExpired ||
        !activeProvider ||
        !pollingSlice ||
        !providerId ||
        !handlerId ||
        !sessionSnap.username
      ) {
        const stopTarget = handlerId ?? this.lastBoundHandlerId
        await this.stopPollingNative(stopTarget)
        this.lastPollingHash = ""
        return
      }

      this.lastBoundHandlerId = handlerId
      const authToken = await readPollingToken(pollingSlice)
      if (!isValid()) return
      if (!authToken) {
        await this.stopPollingNative(handlerId)
        this.lastPollingHash = ""
        return
      }

      const hash = JSON.stringify([
        providerId,
        handlerId,
        sessionSnap.username,
        authToken,
        settings.checkInterval,
        stableFlagsEntries(plan.flags),
        settings.notifyNetworkError,
      ])

      if (hash === this.lastPollingHash && !this.pendingTokenRefresh && !this.pendingCheck) {
        return
      }

      if (!settings.enabled) {
        this.pendingCheck = false
        await this.stopPollingNative(handlerId)
        this.lastPollingHash = ""
        return
      }

      if (!(await this.checkNotificationPermission())) {
        if (!isValid()) return
        this.store.actions.setEnabled(false)
        return
      }
      if (!isValid()) return

      await this.callPolling("configure", {
        handlerId,
        intervalMinutes: settings.checkInterval,
        payload: {
          serverConfig: pollingSlice.getServerConfig(),
          providerId,
          accountHash: hashNotifyAccount(providerId, sessionSnap.username),
          castgc: authToken,
          ...plan.flags,
          notifyNetworkError: settings.notifyNetworkError,
        },
      })
      if (!isValid()) return

      this.lastPollingHash = hash
      this.pendingTokenRefresh = false
      if (this.pendingCheck) {
        this.pendingCheck = false
        await this.callPolling("runNow", { handlerId })
      }
    })

    return this.pollingSync
  }

  async setPollingEnabled(enabled: boolean): Promise<boolean> {
    if (this.disposed) return false
    const plan = this.getPlan()
    const hasPollingChannels = plan.channels.some(
      (item) => item.supported && item.participatesInPolling
    )
    if (enabled && !hasPollingChannels && !this.store.source.getSnapshot().notifyNetworkError) {
      return false
    }

    const revision = ++this.permissionRevision
    const lifecycle = this.lifecycleRevision
    const sessionBefore = this.session.getSnapshot()

    if (!enabled) {
      this.store.actions.setEnabled(false)
      await this.pollingSync
      return true
    }

    if (!this.native.isNative || this.stopped || !sessionBefore.isAuthenticated) {
      return false
    }
    if (!(await this.capabilityAvailable(ACADEMIC_POLLING_CAPABILITY))) {
      return false
    }

    let granted = await this.checkNotificationPermission()
    if (!granted) {
      granted = await this.requestNotificationPermission()
    }
    const sessionAfter = this.session.getSnapshot()
    if (
      !granted ||
      this.disposed ||
      revision !== this.permissionRevision ||
      lifecycle !== this.lifecycleRevision ||
      this.stopped ||
      !sessionAfter.isAuthenticated ||
      sessionAfter.username !== sessionBefore.username
    ) {
      return false
    }

    this.store.actions.setEnabled(true)
    await this.pollingSync
    return true
  }

  async start(): Promise<void> {
    const alreadyEnabled = this.store.source.getSnapshot().enabled
    if (!(await this.setPollingEnabled(true))) {
      throw new Error("Notification permission not granted or polling unavailable")
    }
    if (alreadyEnabled) {
      await this.sync({ checkNow: true })
    }
  }

  async stop(): Promise<void> {
    await this.setPollingEnabled(false)
    await this.pollingSync
  }

  checkNow(): Promise<void> {
    const handlerId = this.resolveHandlerId() ?? this.lastBoundHandlerId
    if (!handlerId) return Promise.resolve()
    return this.enqueueNative(async () => {
      if (this.disposed || !this.native.isNative) return
      await this.callPolling("runNow", { handlerId })
    })
  }

  stopAll(): Promise<void> {
    const handlerId = this.resolveHandlerId() ?? this.lastBoundHandlerId
    this.stopped = true
    this.lifecycleRevision += 1
    this.pollingRevision += 1
    this.lastPollingHash = ""
    this.pendingTokenRefresh = false
    this.pendingCheck = false

    return this.enqueueNative(async () => {
      if (!this.native.isNative) return
      await Promise.allSettled([
        this.stopPollingNative(handlerId),
        this.callNotifications("cancelAll"),
      ])
    })
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
    this.notifyAllChannelsDisabled()
    const stopping = this.stopAll()
    this.disposed = true
    return stopping
  }

  private attachSubscriptions(): void {
    this.unsubscribers.push(
      this.store.source.subscribe(() => {
        const currentEnabled = this.store.source.getSnapshot().enabled
        const enabledJustTurnedOn = currentEnabled && !this.previousStoreEnabled
        this.previousStoreEnabled = currentEnabled
        this.reconcileChannels()
        void this.sync({ checkNow: enabledJustTurnedOn })
      }),
      this.store.hydrated.subscribe(() => {
        this.reconcileChannels()
        void this.sync()
      }),
      this.notifications.state.subscribe(() => {
        this.reconcileChannels()
        void this.sync()
      }),
      this.provider.state.subscribe(() => {
        this.reconcileChannels()
        void this.sync()
      }),
      this.session.state.subscribe(() => {
        const current = this.session.getSnapshot()
        const prev = this.previousSessionSnapshot
        const loggedOutOrSwitchedUser =
          (prev.isAuthenticated && !current.isAuthenticated) || current.username !== prev.username
        const reloggedIn = current.isAuthenticated && prev.sessionExpired && !current.sessionExpired

        this.previousSessionSnapshot = {
          isAuthenticated: current.isAuthenticated,
          username: current.username,
          credential: current.credential,
          sessionExpired: current.sessionExpired,
          hasHydrated: current.hasHydrated,
        }

        if (loggedOutOrSwitchedUser) {
          this.notifyAllChannelsDisabled()
          void this.widgets.clear()
          void this.stopAll()
        }
        if (
          current.isAuthenticated &&
          (!prev.isAuthenticated || current.username !== prev.username)
        ) {
          this.stopped = false
        }

        this.reconcileChannels()
        if (
          current.isAuthenticated !== prev.isAuthenticated ||
          current.username !== prev.username ||
          current.credential !== prev.credential ||
          current.sessionExpired !== prev.sessionExpired ||
          current.hasHydrated !== prev.hasHydrated
        ) {
          void this.sync({
            checkNow: reloggedIn,
            refreshToken: reloggedIn,
          })
        }
      })
    )
  }

  private reconcileChannels(): void {
    const activeProvider = this.provider.getSnapshot().provider
    const currentProviderId = activeProvider?.id ?? null
    const disabledMap = this.store.source.getSnapshot().disabledChannels
    const plan = evaluateNotificationChannels(
      this.notifications.getSnapshot(),
      activeProvider,
      disabledMap
    )

    const nextActive = new Map<string, AcademicNotificationChannel>()
    for (const entry of plan.channels) {
      if (entry.active) {
        nextActive.set(entry.channel.id, entry.channel)
      }
    }

    const providerChanged =
      this.previousProviderId !== null && currentProviderId !== this.previousProviderId
    const previousActive = this.previousActiveChannels

    if (providerChanged) {
      if (this.previousBoundHandlerNeedsStop(currentProviderId)) {
        const previousHandlerId = this.lastBoundHandlerId
        void this.enqueueNative(async () => {
          await this.stopPollingNative(previousHandlerId)
        })
      }
      for (const prevChannel of previousActive.values()) {
        this.invokeChannelHook(prevChannel, "onDisable")
      }
      void this.widgets.clear()
    } else {
      let anyDisabled = false
      for (const [channelId, prevChannel] of previousActive.entries()) {
        if (!nextActive.has(channelId)) {
          anyDisabled = true
          this.invokeChannelHook(prevChannel, "onDisable")
        }
      }
      if (anyDisabled) {
        void this.widgets.clear()
      }
    }

    for (const [channelId, channel] of nextActive.entries()) {
      if (providerChanged || !previousActive.has(channelId)) {
        this.invokeChannelHook(channel, "onEnable")
      }
    }

    this.previousProviderId = currentProviderId
    this.previousActiveChannels = nextActive
  }

  private previousBoundHandlerNeedsStop(nextProviderId: string | null): boolean {
    return Boolean(this.lastBoundHandlerId && this.previousProviderId !== nextProviderId)
  }

  private notifyAllChannelsDisabled(): void {
    for (const channel of this.previousActiveChannels.values()) {
      this.invokeChannelHook(channel, "onDisable")
    }
    this.previousActiveChannels.clear()
  }

  private invokeChannelHook(
    channel: AcademicNotificationChannel,
    hook: "onDisable" | "onEnable"
  ): void {
    const callback = channel[hook]
    if (typeof callback !== "function") return
    try {
      void Promise.resolve(callback()).catch(() => {})
    } catch {
      // A single channel's lifecycle hook must never interrupt reconciliation.
    }
  }

  private enqueueNative(operation: () => Promise<void>): Promise<void> {
    const next = this.nativeQueue.then(operation)
    this.nativeQueue = next.catch(() => {})
    return next
  }

  private async capabilityAvailable(capabilityId: string): Promise<boolean> {
    if (!this.native.isNative) return false
    await this.ensureCapabilitiesLoaded().catch(() => {})
    return this.native.capabilities.has(capabilityId)
  }

  private async callPolling<T = Record<string, unknown>>(
    method: string,
    payload: Record<string, unknown> = {}
  ): Promise<T | undefined> {
    if (!(await this.capabilityAvailable(ACADEMIC_POLLING_CAPABILITY))) return undefined
    return this.native.capabilities.invoke<T>(ACADEMIC_POLLING_CAPABILITY, method, payload)
  }

  private async callNotifications<T = Record<string, unknown>>(
    method: string,
    payload: Record<string, unknown> = {}
  ): Promise<T | undefined> {
    if (!(await this.capabilityAvailable(NOTIFICATIONS_CORE_CAPABILITY))) return undefined
    return this.native.capabilities.invoke<T>(NOTIFICATIONS_CORE_CAPABILITY, method, payload)
  }

  private async stopPollingNative(handlerId: string | undefined): Promise<void> {
    await this.callPolling("stop", handlerId ? { handlerId } : {})
  }
}
