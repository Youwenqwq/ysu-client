import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SettingsState {
  updateMirror: string;
  hasHydrated: boolean;
  setUpdateMirror: (mirror: string) => void;
  setHasHydrated: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      updateMirror: "",
      hasHydrated: false,
      setUpdateMirror: (updateMirror) => set({ updateMirror }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "ysu-settings",
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
