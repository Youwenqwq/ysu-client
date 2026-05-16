import { create } from "zustand";
import type { UpdateInfo } from "./updater";

interface UpdateState {
  hasUpdate: boolean;
  updateInfo: UpdateInfo | null;
  showDialog: boolean;
  setUpdateStatus: (hasUpdate: boolean) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setShowDialog: (open: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  updateInfo: null,
  showDialog: false,
  setUpdateStatus: (hasUpdate) => set({ hasUpdate }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setShowDialog: (showDialog) => set({ showDialog }),
}));
