import { create } from "zustand"

interface PwaUpdateState {
  updateAvailable: boolean
  setUpdateAvailable: (available: boolean) => void
}

export const usePwaUpdateStore = create<PwaUpdateState>((set) => ({
  updateAvailable: false,
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
}))
