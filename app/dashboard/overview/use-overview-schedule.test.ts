import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Course, CurrentWeek, TermCalendar } from "@/providers/types"
import type { ProviderQueryResult } from "@/providers/hooks/use-provider-query"
import { expandScheduleCourses, type SchedulePatch } from "@/lib/academic/schedule-patches"
import { ProviderError, ProviderErrorCode } from "@/providers/errors"
import { useOverviewSchedule, type OverviewSchedule } from "./use-overview-schedule"

const state = vi.hoisted(() => ({
  schedule: {} as ProviderQueryResult<Course[]>,
  week: {} as ProviderQueryResult<CurrentWeek>,
  calendar: {} as ProviderQueryResult<TermCalendar>,
  patches: { hasHydrated: true, byScope: {} as Record<string, SchedulePatch[]> },
}))

vi.mock("@/providers/hooks", () => ({
  useSchedule: () => state.schedule,
  useCurrentWeek: () => state.week,
  useTermCalendar: () => state.calendar,
  useExams: () => ({ data: [] }),
  useClassPeriods: () => ({
    data: [
      { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
      { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
      { section: 3, startTime: "10:00", endTime: "10:45", isInUse: true },
      { section: 4, startTime: "10:55", endTime: "11:40", isInUse: true },
    ],
  }),
}))
vi.mock("@/providers/use-provider", () => ({
  useProvider: () => ({ id: "ysu" }),
  useProviderReady: () => true,
}))
vi.mock("@/lib/server-config", () => ({ getSchoolConfigScope: () => "school" }))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: (select: (value: object) => unknown) =>
    select({ username: "student", hasHydrated: true }),
}))
vi.mock("@/lib/stores/schedule-patches", () => ({
  useSchedulePatchesStore: (select: (value: object) => unknown) => select(state.patches),
  hydrateSchedulePatches: async () => {},
}))
vi.mock("@/lib/stores/settings", () => ({
  useSettingsStore: (select: (value: object) => unknown) =>
    select({ widgetSyncReminderHours: 6, widgetShowNextDaySchedule: true }),
}))
vi.mock("@/lib/native/widget-bridge", () => ({
  syncScheduleToWidget: async () => {},
  syncExamsToWidget: async () => {},
}))
vi.mock("@/lib/native/notify", () => ({ syncClassAlarmsToNative: async () => {} }))
vi.mock("@/hooks/use-academic-time", async () => {
  const { resolveAcademicWeek } = await import("@/lib/academic/academic-time")
  return {
    useAcademicTime: (snapshot: CurrentWeek | null, calendar: TermCalendar | undefined) => ({
      now: new Date("2026-10-20T23:00:00Z"),
      date: "2026-10-21",
      weekday: 3,
      nowMinutes: 420,
      currentWeek: resolveAcademicWeek(snapshot, calendar, "2026-10-21"),
    }),
  }
})

function query<T>(data: T | undefined): ProviderQueryResult<T> {
  return {
    data,
    isLoading: false,
    isValidating: false,
    isError: false,
    error: undefined,
    isStale: false,
    mutate: vi.fn(),
  }
}

function readOverview(): OverviewSchedule {
  let result: OverviewSchedule | undefined
  function Probe() {
    result = useOverviewSchedule()
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  return result!
}

const course: Course = {
  name: "高等数学",
  weekDay: 3,
  startSection: 1,
  endSection: 2,
  weekList: [8],
}
const calendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-08-31",
  totalWeeks: 20,
  teachingWeeks: 18,
  isInUse: true,
}

beforeEach(() => {
  state.schedule = query([course])
  state.week = query<CurrentWeek>({
    semester: calendar.semester,
    week: 8,
    weekday: 3,
    date: "2026-10-21",
  })
  state.calendar = query(calendar)
  state.patches = { hasHydrated: true, byScope: {} }
})

describe("overview schedule availability", () => {
  it("shows today's and next course when the calendar has no week count", () => {
    state.calendar = query({ ...calendar, totalWeeks: 0, teachingWeeks: 0 })
    const result = readOverview()
    expect(result.schedule.data).toEqual([course])
    expect(result.schedule.isLoading).toBe(false)
    expect(result.todayCourses).toEqual([course])
    expect(result.nextCourseInfo).toEqual({ course, range: [480, 580] })
  })

  it("uses a dated week snapshot when the calendar request fails", () => {
    state.calendar = {
      ...query<TermCalendar>(undefined),
      isError: true,
      error: new ProviderError(ProviderErrorCode.NETWORK_ERROR, "offline"),
    }
    const result = readOverview()
    expect(result.todayCourses).toEqual([course])
    expect(result.nextCourseInfo?.course).toEqual(course)
    expect(result.currentWeek.error).toBe(state.calendar.error)
  })

  it("shows provider courses during patch hydration, then applies the saved adjustment", () => {
    const source = expandScheduleCourses([course], calendar.startDate!, 20)[0]
    state.patches = {
      hasHydrated: false,
      byScope: {
        [JSON.stringify(["ysu", "school", "student", calendar.semester])]: [
          {
            id: "move",
            kind: "course",
            mode: "move",
            sourceDate: "2026-10-21",
            targetDate: "2026-10-21",
            targetStartSection: 3,
            source: [source],
            replaced: [],
            note: "",
            createdAt: "2026-10-20T00:00:00Z",
            enabled: true,
            dependsOn: [],
          },
        ],
      },
    }
    expect(readOverview().todayCourses).toEqual([course])
    state.patches.hasHydrated = true
    const adjusted = readOverview()
    expect(adjusted.todayCourses).toHaveLength(1)
    expect(adjusted.todayCourses[0].startSection).toBe(3)
    expect(adjusted.nextCourseInfo?.range).toEqual([600, 700])
  })

  it("preserves loading and failure states when the timetable itself is missing", () => {
    state.schedule = { ...query<Course[]>(undefined), isLoading: true }
    expect(readOverview().schedule.isLoading).toBe(true)
    state.schedule = {
      ...query<Course[]>(undefined),
      isError: true,
      error: new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, "expired"),
    }
    const failed = readOverview()
    expect(failed.schedule.data).toBeUndefined()
    expect(failed.schedule.error).toBe(state.schedule.error)
  })

  it("keeps an empty timetable distinct from unavailable academic dates", () => {
    state.schedule = query<Course[]>([])
    expect(readOverview().schedule.data).toEqual([])
    state.schedule = query([course])
    state.week = query({ week: 8, weekday: 3 })
    state.calendar = query<TermCalendar>({ ...calendar, startDate: undefined })
    const unavailable = readOverview()
    expect(unavailable.currentWeek.data).toBeNull()
    expect(unavailable.schedule.data).toEqual([course])
    expect(unavailable.todayCourses).toEqual([])
  })
})
