import { defineStore } from "@orahako/sdk"
import type { TimePreset } from "./availability"

export const FILTER_ALL = "__all__"

export interface FavoriteRoom {
  readonly code: string
  readonly name: string
  readonly campusDisplay?: string
  readonly buildingDisplay?: string
  readonly classSeats?: number
}

export interface FreeRoomsPrefsState {
  readonly campus: string
  readonly building: string
  readonly onlyFree: boolean
  readonly favoriteRooms: readonly FavoriteRoom[]
}

export const freeRoomsPrefsStore = defineStore({
  init: (): FreeRoomsPrefsState => ({
    campus: FILTER_ALL,
    building: FILTER_ALL,
    onlyFree: true,
    favoriteRooms: [],
  }),
  persist: {
    key: "free-rooms-prefs",
    mode: "local",
    version: 1,
  },
  actions: {
    setCampus(ctx, campus: string) {
      ctx.set((prev) => (prev.campus === campus ? prev : { ...prev, campus, building: FILTER_ALL }))
    },
    setBuilding(ctx, building: string) {
      ctx.set((prev) => (prev.building === building ? prev : { ...prev, building }))
    },
    setOnlyFree(ctx, onlyFree: boolean) {
      ctx.set((prev) => (prev.onlyFree === onlyFree ? prev : { ...prev, onlyFree }))
    },
    toggleFavoriteRoom(ctx, room: FavoriteRoom) {
      ctx.set((prev) => {
        const exists = prev.favoriteRooms.some((item) => item.code === room.code)
        return {
          ...prev,
          favoriteRooms: exists
            ? prev.favoriteRooms.filter((item) => item.code !== room.code)
            : [room, ...prev.favoriteRooms].slice(0, 20),
        }
      })
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type FreeRoomsPrefsStoreInstance = ReturnType<typeof freeRoomsPrefsStore.create>

export interface SelectedFreeRoom {
  readonly code: string
  readonly name: string
  readonly subtitle?: string
}

export interface FreeRoomsViewState {
  readonly preset: TimePreset
  readonly customWeek: number | null
  readonly customDay: number | null
  readonly customStartSection: number
  readonly customEndSection: number
  readonly floorFilter: string
  readonly keyword: string
  readonly selectedRoom: SelectedFreeRoom | null
  readonly detailWeekOverride: number | null
}

export const freeRoomsViewStore = defineStore({
  init: (): FreeRoomsViewState => ({
    preset: "now",
    customWeek: null,
    customDay: null,
    customStartSection: 1,
    customEndSection: 2,
    floorFilter: FILTER_ALL,
    keyword: "",
    selectedRoom: null,
    detailWeekOverride: null,
  }),
  actions: {
    setPreset(ctx, preset: TimePreset) {
      ctx.set((prev) => (prev.preset === preset ? prev : { ...prev, preset }))
    },
    enterCustomSlot(
      ctx,
      slot: { week: number; day: number; startSection: number; endSection: number }
    ) {
      ctx.set((prev) => ({
        ...prev,
        preset: "custom",
        customWeek: slot.week,
        customDay: slot.day,
        customStartSection: slot.startSection,
        customEndSection: slot.endSection,
      }))
    },
    setCustomWeek(ctx, customWeek: number) {
      ctx.set((prev) => ({ ...prev, customWeek: Math.max(1, customWeek) }))
    },
    setCustomDay(ctx, customDay: number) {
      ctx.set((prev) => ({ ...prev, customDay: Math.max(1, Math.min(7, customDay)) }))
    },
    setCustomSections(ctx, startSection: number, endSection: number) {
      const start = Math.max(1, startSection)
      const end = Math.max(start, endSection)
      ctx.set((prev) => ({ ...prev, customStartSection: start, customEndSection: end }))
    },
    setFloorFilter(ctx, floorFilter: string) {
      ctx.set((prev) => (prev.floorFilter === floorFilter ? prev : { ...prev, floorFilter }))
    },
    setKeyword(ctx, keyword: string) {
      ctx.set((prev) => (prev.keyword === keyword ? prev : { ...prev, keyword }))
    },
    selectRoom(ctx, selectedRoom: SelectedFreeRoom | null) {
      ctx.set((prev) => ({ ...prev, selectedRoom, detailWeekOverride: null }))
    },
    setDetailWeekOverride(ctx, detailWeekOverride: number | null) {
      ctx.set((prev) =>
        prev.detailWeekOverride === detailWeekOverride ? prev : { ...prev, detailWeekOverride }
      )
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type FreeRoomsViewStoreInstance = ReturnType<typeof freeRoomsViewStore.create>
