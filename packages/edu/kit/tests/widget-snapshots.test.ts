import type { ClassPeriod, Course, CurrentWeek, Exam, TermCalendar } from "@orahako/academic-sdk"
import { describe, expect, it } from "vitest"

import { buildExamWidgetSnapshot, buildScheduleWidgetSnapshot } from "../src"

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

describe("schedule widget snapshots", () => {
  it("maps courses and the live academic week into a declarative snapshot", () => {
    const snapshot = buildScheduleWidgetSnapshot(
      courses,
      currentWeek,
      periods,
      calendar,
      new Date("2026-09-09T04:00:00Z"),
      "Asia/Shanghai"
    )

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
    expect(
      buildScheduleWidgetSnapshot(
        courses,
        null,
        periods,
        undefined,
        new Date("2026-09-09T04:00:00Z"),
        "Asia/Shanghai"
      ).week
    ).toBeNull()
  })

  it("includes personal single-date and recurring schedule entries while excluding exams", () => {
    const snapshot = buildScheduleWidgetSnapshot(
      courses,
      currentWeek,
      periods,
      calendar,
      new Date("2026-09-09T04:00:00Z"),
      "Asia/Shanghai",
      [
        {
          id: "custom:1",
          sourceId: "personal",
          sourcePluginId: "orahako.schedule",
          category: "personal",
          title: "社团例会",
          location: "学生活动中心",
          date: "2026-09-09",
          weekDay: 3,
          time: { startMinute: 19 * 60, endMinute: 20 * 60 + 30 },
          remindable: true,
        },
        {
          id: "exam:1",
          sourceId: "exams",
          sourcePluginId: "orahako.exams",
          category: "exam",
          title: "高数期末",
          date: "2026-09-09",
          weekDay: 3,
          time: { startMinute: 9 * 60, endMinute: 11 * 60 },
          remindable: false,
        },
      ]
    )

    expect(snapshot.courses).toHaveLength(2)
    expect(snapshot.courses[1]).toEqual({
      name: "社团例会",
      classroom: "学生活动中心",
      week_day: 3,
      week_list: [],
      start_section: 0,
      end_section: 0,
      start_time: "19:00",
      end_time: "20:30",
      date: "2026-09-09",
      category: "personal",
    })
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
})
