import type {
  PluginSettingsCategory,
  PluginSettingsCategoryContribution,
  PluginSettingsService,
} from "@orahako/plugin-sdk"
import type { PluginServiceFactory } from "./runtime"
import { trackPluginRegistration } from "./track-registration"

const DEFAULT_CATEGORY_ORDER = 100

export class PluginSettingsRegistry {
  private readonly categories = new Map<string, PluginSettingsCategory>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly PluginSettingsCategory[] = []

  createService: PluginServiceFactory = (ctx, manifest) => {
    const service: PluginSettingsService = {
      registerCategory: (category) =>
        trackPluginRegistration(ctx, () => this.register(manifest.id, category)),
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
    }
    ctx.set("settings", service)
  }

  getSnapshot = (): readonly PluginSettingsCategory[] => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private register(pluginId: string, category: PluginSettingsCategoryContribution): () => void {
    if (!category.id) throw new Error("Plugin settings category id must not be empty")
    const existing = this.categories.get(category.id)
    if (existing) {
      throw new Error(
        `Plugin settings category already registered: ${category.id} (${existing.pluginId})`
      )
    }
    const registered: PluginSettingsCategory = { ...category, pluginId }
    this.categories.set(category.id, registered)
    this.publish()
    return () => {
      if (this.categories.get(category.id) !== registered) return
      this.categories.delete(category.id)
      this.publish()
    }
  }

  private publish(): void {
    this.snapshot = Array.from(this.categories.values()).sort(
      (a, b) =>
        (a.order ?? DEFAULT_CATEGORY_ORDER) - (b.order ?? DEFAULT_CATEGORY_ORDER) ||
        a.id.localeCompare(b.id)
    )
    for (const listener of this.listeners) listener()
  }
}
