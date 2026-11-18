import { defineStore } from "@orahako/sdk"

export interface ProfileStoreState {
  readonly avatarToken: string
  readonly displayName: string
}

export const profileStore = defineStore({
  init: (): ProfileStoreState => ({
    avatarToken: "",
    displayName: "",
  }),
  persist: {
    key: "profile",
    mode: "local",
    version: 1,
  },
  actions: {
    setAvatarToken(ctx, avatarToken: string) {
      ctx.set((prev) => ({ ...prev, avatarToken }))
    },
    setDisplayName(ctx, displayName: string) {
      ctx.set((prev) => ({ ...prev, displayName: displayName.trim() }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ProfileStoreDefinition = typeof profileStore
export type ProfileStoreInstance = ReturnType<typeof profileStore.create>
