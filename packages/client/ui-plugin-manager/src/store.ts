import { defineStore, type StoreInstance } from "@orahako/sdk"

export interface PluginManagerPreferencesState {
  readonly autoCheckUpdates: boolean
  readonly lastUpdateCheck: number
  readonly showSystemPlugins: boolean
  readonly marketEnabled: boolean
  readonly customMarketUrl: string
}

const initialPreferences = (): PluginManagerPreferencesState => ({
  autoCheckUpdates: true,
  lastUpdateCheck: 0,
  showSystemPlugins: false,
  marketEnabled: false,
  customMarketUrl: "",
})

export const pluginManagerPreferencesStore = defineStore({
  init: initialPreferences,
  persist: {
    key: "preferences",
    mode: "local",
    version: 2,
    migrate(persisted): PluginManagerPreferencesState {
      const previous = persisted as Pick<
        PluginManagerPreferencesState,
        "autoCheckUpdates" | "lastUpdateCheck"
      >
      return { ...initialPreferences(), ...previous }
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
    setMarketEnabled(ctx, marketEnabled: boolean) {
      ctx.set((prev) => (prev.marketEnabled === marketEnabled ? prev : { ...prev, marketEnabled }))
    },
    setCustomMarketUrl(ctx, customMarketUrl: string) {
      ctx.set((prev) =>
        prev.customMarketUrl === customMarketUrl ? prev : { ...prev, customMarketUrl }
      )
    },
  },
})

export type PluginManagerPreferencesStore = typeof pluginManagerPreferencesStore
export type PluginManagerPreferencesStoreInstance = StoreInstance<
  PluginManagerPreferencesState,
  typeof pluginManagerPreferencesStore.spec.actions
>
