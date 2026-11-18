import { defineStore } from "@orahako/sdk"

export interface AnalyticsConsentState {
  readonly consent: boolean
  readonly promptVersion: string | null
}

export const analyticsConsentStore = defineStore({
  init: (): AnalyticsConsentState => ({
    consent: false,
    promptVersion: null,
  }),
  persist: {
    key: "consent",
    mode: "local",
  },
  actions: {
    setConsent(ctx, consent: boolean) {
      ctx.set((prev) => ({
        ...prev,
        consent,
      }))
    },
    recordPromptDecision(ctx, consent: boolean, promptVersion: string) {
      ctx.set({
        consent,
        promptVersion,
      })
    },
  },
})

export type AnalyticsConsentStore = typeof analyticsConsentStore
