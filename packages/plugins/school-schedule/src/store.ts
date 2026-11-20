import { defineStore } from "@orahako/sdk"

export const FILTER_ALL = "__all__"

export type SchoolScheduleTab = "class" | "room"

export interface SelectedSchoolClass {
  readonly classId: string
  readonly className: string
}

export interface SelectedClassroom {
  readonly code: string
  readonly name: string
}

export interface SchoolScheduleFilterState {
  readonly tab: SchoolScheduleTab
  readonly grade: string
  readonly department: string
  readonly major: string
  readonly selectedClass: SelectedSchoolClass | null
  readonly classDrawerOpen: boolean
  readonly campus: string
  readonly building: string
  readonly roomNameInput: string
  readonly searchedRoomName: string
  readonly selectedRoom: SelectedClassroom | null
  readonly roomDrawerOpen: boolean
  readonly weekOverride: number | null
}

export const schoolScheduleFilterStore = defineStore({
  init: (): SchoolScheduleFilterState => ({
    tab: "class",
    grade: FILTER_ALL,
    department: FILTER_ALL,
    major: FILTER_ALL,
    selectedClass: null,
    classDrawerOpen: false,
    campus: FILTER_ALL,
    building: FILTER_ALL,
    roomNameInput: "",
    searchedRoomName: "",
    selectedRoom: null,
    roomDrawerOpen: false,
    weekOverride: null,
  }),
  actions: {
    setTab(ctx, tab: SchoolScheduleTab) {
      ctx.set((prev) => (prev.tab === tab ? prev : { ...prev, tab }))
    },
    setGrade(ctx, grade: string) {
      ctx.set((prev) => (prev.grade === grade ? prev : { ...prev, grade }))
    },
    setDepartment(ctx, department: string) {
      ctx.set((prev) =>
        prev.department === department
          ? prev
          : {
              ...prev,
              department,
              major: FILTER_ALL,
            }
      )
    },
    setMajor(ctx, major: string) {
      ctx.set((prev) => (prev.major === major ? prev : { ...prev, major }))
    },
    selectClass(ctx, selectedClass: SelectedSchoolClass | null) {
      ctx.set((prev) => ({
        ...prev,
        selectedClass,
        weekOverride: null,
      }))
    },
    setClassDrawerOpen(ctx, open: boolean) {
      ctx.set((prev) => (prev.classDrawerOpen === open ? prev : { ...prev, classDrawerOpen: open }))
    },
    setCampus(ctx, campus: string) {
      ctx.set((prev) =>
        prev.campus === campus
          ? prev
          : {
              ...prev,
              campus,
              building: FILTER_ALL,
            }
      )
    },
    setBuilding(ctx, building: string) {
      ctx.set((prev) => (prev.building === building ? prev : { ...prev, building }))
    },
    setRoomNameInput(ctx, roomNameInput: string) {
      ctx.set((prev) => (prev.roomNameInput === roomNameInput ? prev : { ...prev, roomNameInput }))
    },
    submitRoomSearch(ctx) {
      ctx.set((prev) => ({
        ...prev,
        searchedRoomName: prev.roomNameInput.trim(),
        roomDrawerOpen: false,
      }))
    },
    selectRoom(ctx, selectedRoom: SelectedClassroom | null) {
      ctx.set((prev) => ({
        ...prev,
        selectedRoom,
        weekOverride: null,
      }))
    },
    setRoomDrawerOpen(ctx, open: boolean) {
      ctx.set((prev) => (prev.roomDrawerOpen === open ? prev : { ...prev, roomDrawerOpen: open }))
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
