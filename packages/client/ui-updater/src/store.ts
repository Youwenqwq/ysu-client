import { defineStore } from "@orahako/sdk"
import type { UpdateChannel, UpdateInfo } from "./contract"

export interface UpdaterPreferencesState {
  readonly mirror: string
  readonly channel: UpdateChannel
}

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta" || value === "canary"
}

export const updaterPreferencesStore = defineStore({
  init: (): UpdaterPreferencesState => ({
    mirror: "",
    channel: "stable",
  }),
  persist: {
    key: "preferences",
    mode: "local",
    version: 1,
  },
  actions: {
    setMirror(ctx, mirror: string) {
      ctx.set((prev) => (prev.mirror === mirror ? prev : { ...prev, mirror }))
    },
    setChannel(ctx, channel: UpdateChannel) {
      if (!isUpdateChannel(channel)) return
      ctx.set((prev) => (prev.channel === channel ? prev : { ...prev, channel }))
    },
  },
})

export type UpdaterPreferencesStore = typeof updaterPreferencesStore

export interface UpdaterRuntimeState {
  readonly updateInfo: UpdateInfo | null
  readonly showDialog: boolean
  readonly pwaUpdateAvailable: boolean
}

export const updaterRuntimeStore = defineStore({
  init: (): UpdaterRuntimeState => ({
    updateInfo: null,
    showDialog: false,
    pwaUpdateAvailable: false,
  }),
  actions: {
    presentUpdate(ctx, updateInfo: UpdateInfo) {
      ctx.set((prev) => ({
        ...prev,
        updateInfo,
        showDialog: true,
      }))
    },
    setUpdateInfo(ctx, updateInfo: UpdateInfo | null) {
      ctx.set((prev) => (prev.updateInfo === updateInfo ? prev : { ...prev, updateInfo }))
    },
    setShowDialog(ctx, showDialog: boolean) {
      ctx.set((prev) => (prev.showDialog === showDialog ? prev : { ...prev, showDialog }))
    },
    setPwaUpdateAvailable(ctx, pwaUpdateAvailable: boolean) {
      ctx.set((prev) =>
        prev.pwaUpdateAvailable === pwaUpdateAvailable ? prev : { ...prev, pwaUpdateAvailable }
      )
    },
  },
})

export type UpdaterRuntimeStore = typeof updaterRuntimeStore
