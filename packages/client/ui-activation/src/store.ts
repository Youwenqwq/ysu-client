import { defineStore } from "@orahako/sdk"

export interface ActivationState {
  readonly token: string | null
}

export const activationStore = defineStore({
  init: (): ActivationState => ({
    token: null,
  }),
  persist: {
    key: "activation",
    mode: "secure",
  },
  actions: {
    setToken(ctx, token: string) {
      const trimmed = token.trim()
      ctx.set({ token: trimmed.length > 0 ? trimmed : null })
    },
    clearToken(ctx) {
      ctx.set({ token: null })
    },
  },
})

export type ActivationStore = typeof activationStore
