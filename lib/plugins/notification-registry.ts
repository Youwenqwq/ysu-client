import type { PluginNotificationChannel, PluginNotificationService } from "@orahako/plugin-sdk"
import type { PluginServiceFactory } from "./runtime"
import { trackPluginRegistration } from "./track-registration"

export const NOTIFICATION_CHANNELS: readonly PluginNotificationChannel[] = [
  "grades",
  "exams",
  "schedule",
]

export class PluginNotificationRegistry {
  /** Channel → plugin ID → registration count, so repeated registrations stay balanced. */
  private readonly channels = new Map<PluginNotificationChannel, Map<string, number>>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly PluginNotificationChannel[] = []

  getSnapshot = (): readonly PluginNotificationChannel[] => this.snapshot

  createService: PluginServiceFactory = (ctx, manifest) => {
    const service: PluginNotificationService = {
      register: (channel) =>
        trackPluginRegistration(ctx, () => this.register(manifest.id, channel)),
      getSnapshot: this.getSnapshot,
      subscribe: (listener) => {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
    }
    ctx.set("notifications", service)
  }

  private register(pluginId: string, channel: PluginNotificationChannel): () => void {
    if (!NOTIFICATION_CHANNELS.includes(channel)) {
      throw new Error(`Invalid plugin notification channel: ${channel}`)
    }
    const owners = this.channels.get(channel) ?? new Map<string, number>()
    this.channels.set(channel, owners)
    owners.set(pluginId, (owners.get(pluginId) ?? 0) + 1)
    this.publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      const current = this.channels.get(channel)
      const count = current?.get(pluginId)
      if (!current || count === undefined) return
      if (count > 1) {
        current.set(pluginId, count - 1)
        return
      }
      current.delete(pluginId)
      if (current.size === 0) this.channels.delete(channel)
      this.publish()
    }
  }

  private publish(): void {
    const next = NOTIFICATION_CHANNELS.filter(
      (channel) => (this.channels.get(channel)?.size ?? 0) > 0
    )
    if (
      next.length === this.snapshot.length &&
      next.every((channel, index) => channel === this.snapshot[index])
    ) {
      return
    }
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}
