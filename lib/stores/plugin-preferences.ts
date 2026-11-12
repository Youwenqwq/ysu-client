import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { localStorageAdapter } from "@/lib/storage/local"

interface PluginPreferencesState {
  activeTheme?: string
  disabledPluginIds: string[]
  autoCheckUpdates: boolean
  lastUpdateCheck: number
  setActiveTheme(id?: string): void
  setAutoCheckUpdates(enabled: boolean): void
  setLastUpdateCheck(timestamp: number): void
  setPluginDisabled(id: string, disabled: boolean): void
}

export const usePluginPreferences = create<PluginPreferencesState>()(
  persist(
    (set) => ({
      activeTheme: undefined,
      disabledPluginIds: [],
      autoCheckUpdates: true,
      lastUpdateCheck: 0,
      setActiveTheme: (activeTheme) => set({ activeTheme }),
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
      name: "academic-client-plugins",
      storage: createJSONStorage(() => localStorageAdapter),
      partialize: (state) => ({
        activeTheme: state.activeTheme,
        disabledPluginIds: state.disabledPluginIds,
        autoCheckUpdates: state.autoCheckUpdates,
        lastUpdateCheck: state.lastUpdateCheck,
      }),
    }
  )
)
