import { defineStore, type StoreInstance } from "@orahako/sdk"

export interface PluginManagerPreferencesState {
  readonly autoCheckUpdates: boolean
  readonly lastUpdateCheck: number
  readonly showSystemPlugins: boolean
}

const initialPreferences = (): PluginManagerPreferencesState => ({
  autoCheckUpdates: true,
  lastUpdateCheck: 0,
  showSystemPlugins: false,
})

export const pluginManagerPreferencesStore = defineStore({
  init: initialPreferences,
  persist: {
    key: "preferences",
    mode: "local",
    version: 3,
    migrate(persisted): PluginManagerPreferencesState {
      const previous = persisted as Partial<PluginManagerPreferencesState> | undefined
      return {
        autoCheckUpdates: previous?.autoCheckUpdates ?? true,
        lastUpdateCheck: previous?.lastUpdateCheck ?? 0,
        showSystemPlugins: previous?.showSystemPlugins ?? false,
      }
    },
  },
  actions: {
    setAutoCheckUpdates(ctx, autoCheckUpdates: boolean) {
      ctx.set((prev) =>
        prev.autoCheckUpdates === autoCheckUpdates ? prev : { ...prev, autoCheckUpdates }
      )
    },
    setLastUpdateCheck(ctx, lastUpdateCheck: number) {
      ctx.set((prev) =>
        prev.lastUpdateCheck === lastUpdateCheck ? prev : { ...prev, lastUpdateCheck }
      )
    },
    setShowSystemPlugins(ctx, showSystemPlugins: boolean) {
      ctx.set((prev) =>
        prev.showSystemPlugins === showSystemPlugins ? prev : { ...prev, showSystemPlugins }
      )
    },
  },
})

export type PluginManagerPreferencesStore = typeof pluginManagerPreferencesStore
export type PluginManagerPreferencesStoreInstance = StoreInstance<
  PluginManagerPreferencesState,
  typeof pluginManagerPreferencesStore.spec.actions
>
