import { defineStore } from "@orahako/sdk"
import type { PluginAnnouncement } from "./contract"

export interface AnnouncementModalState {
  readonly announcement: PluginAnnouncement | null
  readonly open: boolean
}

export const announcementStore = defineStore({
  init: (): AnnouncementModalState => ({
    announcement: null,
    open: false,
  }),
  actions: {
    present(ctx, announcement: PluginAnnouncement) {
      ctx.set({
        announcement,
        open: true,
      })
    },
    close(ctx) {
      ctx.set((prev) => (prev.open ? { ...prev, open: false } : prev))
    },
  },
})

export type AnnouncementStore = typeof announcementStore
