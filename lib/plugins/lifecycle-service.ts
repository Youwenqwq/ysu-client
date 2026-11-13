import type { PluginLifecycleService } from "@orahako/plugin-sdk"
import type { PluginServiceFactory } from "./runtime"
import { trackPluginRegistration } from "./track-registration"

export class PluginLifecycleRegistry {
  private providerReady = false
  private readonly listeners = new Set<() => void | Promise<void>>()

  createService: PluginServiceFactory = (ctx) => {
    const service: PluginLifecycleService = {
      onProviderReady: (listener) =>
        trackPluginRegistration(ctx, () => {
          this.listeners.add(listener)
          if (this.providerReady) this.invoke(listener)
          return () => {
            this.listeners.delete(listener)
          }
        }),
    }
    ctx.set("hostLifecycle", service)
  }

  setProviderReady(ready: boolean): void {
    this.providerReady = ready
    if (ready) for (const listener of this.listeners) this.invoke(listener)
  }

  private invoke(listener: () => void | Promise<void>): void {
    void Promise.resolve()
      .then(() => {
        if (this.listeners.has(listener)) return listener()
      })
      .catch((error) => console.error("Plugin provider-ready listener failed", error))
  }
}
