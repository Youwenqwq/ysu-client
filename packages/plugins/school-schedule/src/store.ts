import { defineStore } from "@orahako/sdk"

export const FILTER_ALL = "__all__"

export type SchoolScheduleTab = "class" | "room"

export interface SelectedSchoolClass {
  readonly classId: string
  readonly className: string
  readonly subtitle?: string
}

export interface SelectedClassroom {
  readonly code: string
  readonly name: string
  readonly subtitle?: string
}

export interface SchoolSchedulePrefsState {
  readonly tab: SchoolScheduleTab
  readonly grade: string
  readonly department: string
  readonly major: string
  readonly campus: string
  readonly building: string
  readonly favoriteClasses: readonly SelectedSchoolClass[]
  readonly favoriteRooms: readonly SelectedClassroom[]
}

export const schoolSchedulePrefsStore = defineStore({
  init: (): SchoolSchedulePrefsState => ({
    tab: "class",
    grade: FILTER_ALL,
    department: FILTER_ALL,
    major: FILTER_ALL,
    campus: FILTER_ALL,
    building: FILTER_ALL,
    favoriteClasses: [],
    favoriteRooms: [],
  }),
  persist: {
    key: "school-schedule-prefs",
    mode: "local",
    version: 1,
  },
  actions: {
    setTab(ctx, tab: SchoolScheduleTab) {
      ctx.set((prev) => (prev.tab === tab ? prev : { ...prev, tab }))
    },
    setGrade(ctx, grade: string) {
      ctx.set((prev) => (prev.grade === grade ? prev : { ...prev, grade }))
    },
    setDepartment(ctx, department: string) {
      ctx.set((prev) =>
        prev.department === department ? prev : { ...prev, department, major: FILTER_ALL }
      )
    },
    setMajor(ctx, major: string) {
      ctx.set((prev) => (prev.major === major ? prev : { ...prev, major }))
    },
    setCampus(ctx, campus: string) {
      ctx.set((prev) => (prev.campus === campus ? prev : { ...prev, campus, building: FILTER_ALL }))
    },
    setBuilding(ctx, building: string) {
      ctx.set((prev) => (prev.building === building ? prev : { ...prev, building }))
    },
    toggleFavoriteClass(ctx, cls: SelectedSchoolClass) {
      ctx.set((prev) => {
        const exists = prev.favoriteClasses.some((item) => item.classId === cls.classId)
        return {
          ...prev,
          favoriteClasses: exists
            ? prev.favoriteClasses.filter((item) => item.classId !== cls.classId)
            : [cls, ...prev.favoriteClasses].slice(0, 20),
        }
      })
    },
    toggleFavoriteRoom(ctx, room: SelectedClassroom) {
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

export type SchoolSchedulePrefsStoreInstance = ReturnType<typeof schoolSchedulePrefsStore.create>

export interface SchoolScheduleFilterState {
  readonly classKeyword: string
  readonly selectedClass: SelectedSchoolClass | null
  readonly roomNameInput: string
  readonly searchedRoomName: string
  readonly selectedRoom: SelectedClassroom | null
  readonly weekOverride: number | null
}

export const schoolScheduleFilterStore = defineStore({
  init: (): SchoolScheduleFilterState => ({
    classKeyword: "",
    selectedClass: null,
    roomNameInput: "",
    searchedRoomName: "",
    selectedRoom: null,
    weekOverride: null,
  }),
  actions: {
    setClassKeyword(ctx, classKeyword: string) {
      ctx.set((prev) => (prev.classKeyword === classKeyword ? prev : { ...prev, classKeyword }))
    },
    selectClass(ctx, selectedClass: SelectedSchoolClass | null) {
      ctx.set((prev) => ({
        ...prev,
        selectedClass,
        weekOverride: null,
      }))
    },
    setRoomNameInput(ctx, roomNameInput: string) {
      ctx.set((prev) => (prev.roomNameInput === roomNameInput ? prev : { ...prev, roomNameInput }))
    },
    submitRoomSearch(ctx) {
      ctx.set((prev) => ({
        ...prev,
        searchedRoomName: prev.roomNameInput.trim(),
      }))
    },
    selectRoom(ctx, selectedRoom: SelectedClassroom | null) {
      ctx.set((prev) => ({
        ...prev,
        selectedRoom,
        weekOverride: null,
      }))
    },
    setWeekOverride(ctx, weekOverride: number | null) {
      ctx.set((prev) => (prev.weekOverride === weekOverride ? prev : { ...prev, weekOverride }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type SchoolScheduleFilterStoreInstance = ReturnType<typeof schoolScheduleFilterStore.create>
