import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"


interface PluginPreferencesState {
  activeShell?: string
  disabledPluginIds: string[]
  autoCheckUpdates: boolean
  lastUpdateCheck: number
  setActiveShell(id?: string): void
  setAutoCheckUpdates(enabled: boolean): void
  setLastUpdateCheck(timestamp: number): void
  setPluginDisabled(id: string, disabled: boolean): void
}

export const usePluginPreferences = create<PluginPreferencesState>()(
  persist(
    (set) => ({
      activeShell: undefined,
      disabledPluginIds: [],
      autoCheckUpdates: true,
      lastUpdateCheck: 0,
      setActiveShell: (activeShell) => set({ activeShell }),
      setAutoCheckUpdates: (autoCheckUpdates) => set({ autoCheckUpdates }),
      setLastUpdateCheck: (lastUpdateCheck) => set({ lastUpdateCheck }),
      setPluginDisabled: (id, disabled) =>
        set((state) => ({
          disabledPluginIds: disabled
            ? Array.from(new Set([...state.disabledPluginIds, id]))
            : state.disabledPluginIds.filter((item) => item !== id),
        })),
    }),
    {
      name: "orahako-plugins",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeShell: state.activeShell,
        disabledPluginIds: state.disabledPluginIds,
        autoCheckUpdates: state.autoCheckUpdates,
        lastUpdateCheck: state.lastUpdateCheck,
      }),
    }
  )
)
