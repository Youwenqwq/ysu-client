import { create } from "zustand";
import type { AnnouncementInfo } from "@/lib/announcement";

interface AnnouncementState {
  announcementInfo: AnnouncementInfo | null;
  showDialog: boolean;
  setAnnouncementInfo: (info: AnnouncementInfo | null) => void;
  setShowDialog: (open: boolean) => void;
}

export const useAnnouncementStore = create<AnnouncementState>((set) => ({
  announcementInfo: null,
  showDialog: false,
  setAnnouncementInfo: (announcementInfo) => set({ announcementInfo }),
  setShowDialog: (showDialog) => set({ showDialog }),
}));
