import { create } from "zustand"
import type { PluginAnnouncement } from "@orahako/plugin-sdk"

interface AnnouncementState {
  announcementInfo: PluginAnnouncement | null
  showDialog: boolean
  setAnnouncementInfo: (info: PluginAnnouncement | null) => void
  setShowDialog: (open: boolean) => void
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  announcementInfo: null,
  showDialog: false,
  setAnnouncementInfo: (announcementInfo) => set({ announcementInfo }),
  setShowDialog: (showDialog) => set({ showDialog }),
}))
