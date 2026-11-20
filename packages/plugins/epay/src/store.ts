import { defineStore } from "@orahako/sdk"

export interface EpayAccountSetting {
  readonly lastCheckedAt: number
}

export interface EpaySettingsState {
  readonly notifyEnabled: boolean
  readonly accountSettings: Record<string, EpayAccountSetting>
}

export const epaySettingsStore = defineStore({
  init: (): EpaySettingsState => ({
    notifyEnabled: true,
    accountSettings: {},
  }),
  persist: {
    key: "epay-settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setNotifyEnabled(ctx, notifyEnabled: boolean) {
      ctx.set((prev) => (prev.notifyEnabled === notifyEnabled ? prev : { ...prev, notifyEnabled }))
    },
    setLastCheckedAt(ctx, username: string, lastCheckedAt: number) {
      if (!username) return
      ctx.set((prev) => ({
        ...prev,
        accountSettings: {
          ...prev.accountSettings,
          [username]: { lastCheckedAt },
        },
      }))
    },
    clearAccountSettings(ctx) {
      ctx.set((prev) => ({
        ...prev,
        accountSettings: {},
      }))
    },
  },
})

export type EpaySettingsStoreInstance = ReturnType<typeof epaySettingsStore.create>
