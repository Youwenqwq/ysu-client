import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  ClassPeriod,
  Course,
  CurrentWeek,
  Exam,
  TermCalendar,
} from "@orahako/plugin-sdk/academic"
import type { PluginNativeService } from "@orahako/plugin-sdk"

const platform = vi.hoisted(() => ({
  invokeWidgetCapability: vi.fn(),
}))

vi.mock("@/plugins/official/runtime/native/widget-bridge", () => ({
  WIDGETS_SCHEDULE_CAPABILITY: "widgets.schedule@1",
  WIDGETS_EXAM_CAPABILITY: "widgets.exam@1",
  invokeWidgetCapability: platform.invokeWidgetCapability,
}))

import {
  buildExamWidgetSnapshot,
  buildScheduleWidgetSnapshot,
  syncExamWidgets,
  syncScheduleWidgetSettings,
  syncScheduleWidgets,
} from "./widget-snapshots"

const native = {} as PluginNativeService

const calendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-09-07",
  totalWeeks: 20,
  teachingWeeks: 18,
  isInUse: true,
}

const periods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
]

const courses: Course[] = [
  {
    name: "高等数学",
    classroom: "A101",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weeks: "1-16",
    weekList: [1, 2, 3],
  },
]

const currentWeek: CurrentWeek = {
  week: 1,
  weekday: 3,
  semester: "2026-2027-1",
  date: "2026-09-09",
}

afterEach(() => {
  vi.useRealTimers()
  platform.invokeWidgetCapability.mockReset()
})

describe("schedule widget snapshots", () => {
  it("maps courses and the live academic week into a declarative snapshot", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-09T04:00:00Z"))

    const snapshot = buildScheduleWidgetSnapshot(courses, currentWeek, periods, calendar)

    expect(snapshot.courses).toEqual([
      {
        name: "高等数学",
        classroom: "A101",
        week_day: 1,
        week_list: [1, 2, 3],
        start_section: 1,
        end_section: 2,
        start_time: "08:00",
        end_time: "09:40",
      },
    ])
    expect(snapshot.week).toEqual({
      week: 1,
      weekday: 3,
      term: "2026-2027-1",
      date: "2026-09-09",
      total_weeks: 20,
      full_schedule: true,
    })
  })

  it("never claims a synced week when no dated anchor exists", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-09T04:00:00Z"))

    expect(buildScheduleWidgetSnapshot(courses, null, periods).week).toBeNull()
  })

  it("sends snapshots and settings through the schedule companion contract", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-09T04:00:00Z"))

    await syncScheduleWidgets(native, courses, currentWeek, periods, 12, true, calendar)

    expect(platform.invokeWidgetCapability).toHaveBeenCalledWith(
      native,
      "widgets.schedule@1",
      "sync",
      {
        snapshot: buildScheduleWidgetSnapshot(courses, currentWeek, periods, calendar),
        settings: { syncReminderHours: 12, showNextDaySchedule: true },
      }
    )
  })

  it("updates settings without needing a new snapshot", async () => {
    await syncScheduleWidgetSettings(native, 6, false)

    expect(platform.invokeWidgetCapability).toHaveBeenCalledWith(
      native,
      "widgets.schedule@1",
      "settings",
      { settings: { syncReminderHours: 6, showNextDaySchedule: false } }
    )
  })
})

describe("exam widget snapshots", () => {
  const exams: Exam[] = [
    {
      name: "高等数学",
      examName: "期末考试",
      startAt: "2026-12-28T09:00:00",
      endAt: "2026-12-28T11:00:00",
      timeText: "09:00-11:00",
      examLocation: "A101",
      seatNumber: "12",
    },
  ]

  it("maps provider exams into the declarative snapshot", () => {
    expect(buildExamWidgetSnapshot(exams)).toEqual({
      exams: [
        {
          name: "高等数学",
          exam_name: "期末考试",
          start_at: "2026-12-28T09:00:00",
          end_at: "2026-12-28T11:00:00",
          time_text: "09:00-11:00",
          exam_location: "A101",
          seat_number: "12",
        },
      ],
    })
  })

  it("sends the exam snapshot and reminder settings through the companion contract", async () => {
    await syncExamWidgets(native, exams, 6)

    expect(platform.invokeWidgetCapability).toHaveBeenCalledWith(
      native,
      "widgets.exam@1",
      "sync",
      {
        snapshot: buildExamWidgetSnapshot(exams),
        settings: { syncReminderHours: 6 },
      }
    )
  })
})
