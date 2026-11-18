import { defineStore } from "@orahako/sdk"

export type ActivityDensity = "compact" | "detailed" | "debug"

export interface ActivitySettingsState {
  readonly density: ActivityDensity
  readonly showTiming: boolean
  readonly showMascots: boolean
  readonly longMascots: boolean
}

export function isActivityDensity(value: unknown): value is ActivityDensity {
  return value === "compact" || value === "detailed" || value === "debug"
}

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettingsState = {
  density: "compact",
  showTiming: false,
  showMascots: true,
  longMascots: false,
}

export const activitySettingsStore = defineStore({
  init: (): ActivitySettingsState => ({ ...DEFAULT_ACTIVITY_SETTINGS }),
  persist: {
    key: "settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setDensity(ctx, density: ActivityDensity) {
      if (!isActivityDensity(density)) return
      ctx.set((prev) => (prev.density === density ? prev : { ...prev, density }))
    },
    setShowTiming(ctx, showTiming: boolean) {
      ctx.set((prev) => (prev.showTiming === showTiming ? prev : { ...prev, showTiming }))
    },
    setShowMascots(ctx, showMascots: boolean) {
      ctx.set((prev) => (prev.showMascots === showMascots ? prev : { ...prev, showMascots }))
    },
    setLongMascots(ctx, longMascots: boolean) {
      ctx.set((prev) => (prev.longMascots === longMascots ? prev : { ...prev, longMascots }))
    },
  },
})

export type ActivitySettingsStore = typeof activitySettingsStore
