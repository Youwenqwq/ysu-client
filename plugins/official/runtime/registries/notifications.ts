import type { Context } from "@cordisjs/core"
import {
  PLUGIN_SERVICE_SCOPE,
  type PluginManifest,
  type ScopedPluginService,
  trackPluginRegistration,
} from "@orahako/plugin-sdk"

/**
 * Built-in channel order. Channels are open strings; the history of the
 * built-in set only decides where its members appear in the snapshot, and any
 * other channel is appended in first-registration order.
 */
export const NOTIFICATION_CHANNELS: readonly string[] = ["grades", "exams", "schedule"]

export interface PluginNotificationServiceFacade {
  register(channel: string): () => void
  getSnapshot(): readonly string[]
  subscribe(listener: () => void): () => void
}

export class PluginNotificationRegistry
  implements ScopedPluginService<PluginNotificationServiceFacade>
{
  /** Channel → plugin ID → registration count, so repeated registrations stay balanced. */
  private readonly channels = new Map<string, Map<string, number>>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly string[] = [];

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginNotificationServiceFacade {
    return {
      register: (channel) =>
        trackPluginRegistration(ctx, () => this.register(manifest.id, channel)),
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
    }
  }

  getSnapshot = (): readonly string[] => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private register(pluginId: string, channel: string): () => void {
    if (!channel) throw new Error("Plugin notification channel must not be empty")
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
    const next: string[] = []
    for (const channel of NOTIFICATION_CHANNELS) {
      if ((this.channels.get(channel)?.size ?? 0) > 0) next.push(channel)
    }
    for (const [channel, owners] of this.channels) {
      if (owners.size === 0) continue
      if (NOTIFICATION_CHANNELS.includes(channel)) continue
      next.push(channel)
    }
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
