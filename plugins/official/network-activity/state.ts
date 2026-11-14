import { create } from "zustand"
import type { PluginKeyValueStorage } from "@orahako/plugin-sdk"

export type ActivityDensity = "compact" | "detailed" | "debug"

export const DENSITY_STORAGE_KEY = "density"
export const TIMING_STORAGE_KEY = "showTiming"

interface ActivitySettingsState {
  density: ActivityDensity
  showTiming: boolean
  setDensity: (density: ActivityDensity) => void
  setShowTiming: (showTiming: boolean) => void
}

export const useActivitySettings = create<ActivitySettingsState>((set) => ({
  density: "compact",
  showTiming: false,
  setDensity: (density) => set({ density }),
  setShowTiming: (showTiming) => set({ showTiming }),
}))

export function isActivityDensity(value: unknown): value is ActivityDensity {
  return value === "compact" || value === "detailed" || value === "debug"
}

export async function loadActivitySettings(storage: PluginKeyValueStorage): Promise<void> {
  try {
    const [density, showTiming] = await Promise.all([
      storage.getItem(DENSITY_STORAGE_KEY),
      storage.getItem(TIMING_STORAGE_KEY),
    ])
    const state = useActivitySettings.getState()
    if (isActivityDensity(density)) state.setDensity(density)
    if (showTiming === "true") state.setShowTiming(true)
    else if (showTiming === "false") state.setShowTiming(false)
  } catch {
    // Keep the compact, timing-free defaults when plugin storage is unavailable.
  }
}
