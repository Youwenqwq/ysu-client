import type {
  AcademicNotificationChannel,
  AcademicNotificationChannelSpec,
  AcademicNotificationService,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type Context,
  type ObservableSource,
  type PluginManifest,
  type ScopedPluginService,
} from "@orahako/sdk"

export const BUILT_IN_NOTIFICATION_CHANNELS = ["grades", "exams", "schedule"] as const

interface ChannelRegistration {
  readonly channel: AcademicNotificationChannel
  active: boolean
}

function sameChannelEntry(
  left: AcademicNotificationChannel,
  right: AcademicNotificationChannel
): boolean {
  return (
    left.id === right.id &&
    left.pluginId === right.pluginId &&
    left.slice === right.slice &&
    left.toPollingFlag === right.toPollingFlag &&
    left.onDisable === right.onDisable &&
    left.onEnable === right.onEnable
  )
}

function sameChannelList(
  left: readonly AcademicNotificationChannel[],
  right: readonly AcademicNotificationChannel[]
): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, idx) => sameChannelEntry(entry, right[idx]!))
}

export class AcademicNotificationRegistry
  implements AcademicNotificationService, ScopedPluginService<AcademicNotificationService>
{
  readonly state: ObservableSource<readonly AcademicNotificationChannel[]>

  private readonly registrations: ChannelRegistration[] = []
  private readonly stateSource = createObservableSource<readonly AcademicNotificationChannel[]>(
    [],
    sameChannelList
  )

  constructor() {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): AcademicNotificationService {
    return {
      state: this.state,
      registerChannel: (spec) =>
        trackPluginRegistration(ctx, () => this.addChannel(manifest.id, spec)),
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
    }
  }

  registerChannel = (spec: AcademicNotificationChannelSpec): (() => void) => {
    return this.addChannel("root", spec)
  }

  getSnapshot = (): readonly AcademicNotificationChannel[] => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  private addChannel(pluginId: string, spec: AcademicNotificationChannelSpec): () => void {
    if (!spec.id || !spec.id.trim()) {
      throw new Error("Academic notification channel id must not be empty")
    }
    const channel: AcademicNotificationChannel = {
      ...spec,
      pluginId,
    }
    const entry: ChannelRegistration = { channel, active: true }
    this.registrations.push(entry)
    this.publish()

    return () => {
      if (!entry.active) return
      entry.active = false
      const idx = this.registrations.indexOf(entry)
      if (idx >= 0) {
        this.registrations.splice(idx, 1)
      }
      this.publish()
    }
  }

  private publish(): void {
    // Latest active registration for a given channel id wins, preserving first-seen custom order
    const byId = new Map<string, AcademicNotificationChannel>()
    const firstSeenOrder: string[] = []

    for (const registration of this.registrations) {
      if (!registration.active) continue
      const { id } = registration.channel
      if (!byId.has(id)) {
        firstSeenOrder.push(id)
      }
      byId.set(id, registration.channel)
    }

    const ordered: AcademicNotificationChannel[] = []
    const builtInSet = new Set<string>(BUILT_IN_NOTIFICATION_CHANNELS)

    for (const builtInId of BUILT_IN_NOTIFICATION_CHANNELS) {
      const found = byId.get(builtInId)
      if (found) {
        ordered.push(found)
      }
    }

    for (const id of firstSeenOrder) {
      if (builtInSet.has(id)) continue
      const found = byId.get(id)
      if (found) {
        ordered.push(found)
      }
    }

    this.stateSource.set(ordered)
  }
}

export const notificationRegistryRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.notifications",
    name: "Academic notification channel registry",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "Scoped registration of academic notification channels and polling mappings.",
    provides: ["notifications"],
  },
  apply(ctx) {
    ctx.set("notifications", new AcademicNotificationRegistry())
  },
})
