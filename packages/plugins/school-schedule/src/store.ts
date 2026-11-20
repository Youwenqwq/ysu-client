import type { QuerySnapshot } from "@orahako/academic-sdk"
import { defineStore, type ObservableSource } from "@orahako/sdk"

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

const IDLE_REFRESH = async (): Promise<undefined> => undefined

function createIdleQuerySnapshot<T>(): QuerySnapshot<T> {
  return {
    status: "idle",
    data: undefined,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: null,
    refresh: IDLE_REFRESH,
  }
}

/**
 * React-free dynamic multiplexer binding an `ObservableSource` state slice to a
 * parameterized `QueryService.source(...)` handle. Only activates the underlying
 * query when `resolveSource` returns a non-null source AND at least one subscriber
 * is attached.
 */
export function createParameterizedQuerySource<S, K, T>(options: {
  readonly state: ObservableSource<S>
  readonly selectKey: (state: S) => K
  readonly serializeKey: (key: K) => string
  readonly resolveSource: (key: K) => ObservableSource<QuerySnapshot<T>> | null
}): ObservableSource<QuerySnapshot<T>> {
  const idleSnapshot = createIdleQuerySnapshot<T>()
  const subscribers = new Set<() => void>()
  let activeKeySerialized: string | null = null
  let activeInner: ObservableSource<QuerySnapshot<T>> | null = null
  let unsubscribeState: (() => void) | null = null
  let unsubscribeInner: (() => void) | null = null

  const notify = (): void => {
    for (const listener of [...subscribers]) {
      listener()
    }
  }

  const rebind = (shouldNotify: boolean): void => {
    const key = options.selectKey(options.state.getSnapshot())
    const serialized = options.serializeKey(key)
    if (serialized === activeKeySerialized) return

    unsubscribeInner?.()
    unsubscribeInner = null
    activeKeySerialized = serialized
    activeInner = options.resolveSource(key)
    if (activeInner && subscribers.size > 0) {
      unsubscribeInner = activeInner.subscribe(notify)
    }
    if (shouldNotify) {
      notify()
    }
  }

  return {
    getSnapshot(): QuerySnapshot<T> {
      if (subscribers.size === 0) {
        const key = options.selectKey(options.state.getSnapshot())
        const inner = options.resolveSource(key)
        return inner ? inner.getSnapshot() : idleSnapshot
      }
      return activeInner ? activeInner.getSnapshot() : idleSnapshot
    },
    subscribe(listener: () => void): () => void {
      const wasEmpty = subscribers.size === 0
      subscribers.add(listener)
      if (wasEmpty) {
        activeKeySerialized = null
        rebind(false)
        unsubscribeState = options.state.subscribe(() => {
          rebind(true)
        })
      }
      return () => {
        subscribers.delete(listener)
        if (subscribers.size === 0) {
          unsubscribeInner?.()
          unsubscribeInner = null
          unsubscribeState?.()
          unsubscribeState = null
          activeInner = null
          activeKeySerialized = null
        }
      }
    },
  }
}

/**
 * Minute-granularity wall-clock observable source, automatically starting when
 * subscribed and stopping when all subscribers detach or `dispose()` is called.
 */
export function createMinuteClockSource(nowMs: () => number = Date.now): {
  readonly source: ObservableSource<number>
  dispose(): void
} {
  const listeners = new Set<() => void>()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const readBucket = (): number => Math.floor(nowMs() / 60_000) * 60_000
  let currentBucket = readBucket()

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const scheduleNext = (): void => {
    clearTimer()
    if (disposed || listeners.size === 0) return
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const delay = Math.max(250, 60_000 - (nowMs() % 60_000))
    timer = setTimeout(tick, delay)
  }

  const tick = (): void => {
    if (disposed) return
    const nextBucket = readBucket()
    if (nextBucket !== currentBucket) {
      currentBucket = nextBucket
      for (const listener of [...listeners]) {
        listener()
      }
    }
    scheduleNext()
  }

  const attachVisibility = (): (() => void) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return () => {}
    }
    const onWake = (): void => tick()
    if (typeof window.addEventListener === "function") {
      window.addEventListener("focus", onWake)
    }
    if (typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onWake)
    }
    return () => {
      if (typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onWake)
      }
      if (typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onWake)
      }
    }
  }

  let detachVisibility: (() => void) | null = null

  return {
    source: {
      getSnapshot: () => readBucket(),
      subscribe(listener: () => void): () => void {
        if (disposed) return () => {}
        const wasEmpty = listeners.size === 0
        listeners.add(listener)
        if (wasEmpty) {
          currentBucket = readBucket()
          detachVisibility = attachVisibility()
          scheduleNext()
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) {
            clearTimer()
            detachVisibility?.()
            detachVisibility = null
          }
        }
      },
    },
    dispose(): void {
      disposed = true
      clearTimer()
      detachVisibility?.()
      detachVisibility = null
      listeners.clear()
    },
  }
}
