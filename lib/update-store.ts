import { create } from "zustand";

interface UpdateState {
  hasUpdate: boolean;
  setUpdateStatus: (hasUpdate: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  hasUpdate: false,
  setUpdateStatus: (hasUpdate) => set({ hasUpdate }),
}));
