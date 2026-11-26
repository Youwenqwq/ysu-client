import { defineStore } from "@orahako/sdk"

export interface AnalyticsConsentState {
  readonly consent: boolean
  readonly decided: boolean
}

export const analyticsConsentStore = defineStore({
  init: (): AnalyticsConsentState => ({
    consent: false,
    decided: false,
  }),
  persist: {
    key: "consent",
    mode: "local",
  },
  actions: {
    setConsent(ctx, consent: boolean) {
      ctx.set({
        consent,
        decided: true,
      })
    },
  },
})

export type AnalyticsConsentStore = typeof analyticsConsentStore
