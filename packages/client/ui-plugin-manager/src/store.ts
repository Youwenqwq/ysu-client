import { defineStore } from "@orahako/sdk"

export interface PluginManagerPreferencesState {
  readonly autoCheckUpdates: boolean
  readonly lastUpdateCheck: number
}

export const pluginManagerPreferencesStore = defineStore({
  init: (): PluginManagerPreferencesState => ({
    autoCheckUpdates: true,
    lastUpdateCheck: 0,
  }),
  persist: {
    key: "preferences",
    mode: "local",
    version: 1,
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
  },
})

export type PluginManagerPreferencesStore = typeof pluginManagerPreferencesStore
