import type { ClassPeriod, Course, CurrentWeek, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"
import { describe, expect, it } from "vitest"

import { buildCalendarSyncEvents, serializeCalendarIcs } from "../src"

const calendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-09-07",
  totalWeeks: 2,
  teachingWeeks: 2,
  isInUse: true,
}

const currentWeek: CurrentWeek = {
  week: 1,
  weekday: 1,
  semester: "2026-2027-1",
  date: "2026-09-07",
}

const periods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
]

const courses: Course[] = [
  {
    name: "高等数学",
    teacher: "张老师",
    classroom: "A101",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weeks: "1-2",
    weekList: [1, 2],
    scheduleId: "SCH-1",
  },
]

const extraEntries: ScheduleEntry[] = [
  {
    id: "personal:once",
    sourceId: "personal",
    sourcePluginId: "orahako.schedule",
    category: "personal",
    title: "社团例会",
    location: "活动中心",
    date: "2026-09-09",
    weekDay: 3,
    time: { startMinute: 19 * 60, endMinute: 20 * 60 },
    remindable: true,
  },
  {
    id: "personal:weekly",
    sourceId: "personal",
    sourcePluginId: "orahako.schedule",
    category: "personal",
    title: "英语晨读",
    weekDay: 2,
    time: { startMinute: 7 * 60 + 30, endMinute: 8 * 60 },
    remindable: false,
  },
  {
    id: "exam:math",
    sourceId: "exams",
    sourcePluginId: "orahako.exams",
    category: "exam",
    title: "高等数学期末",
    location: "东区B201",
    date: "2026-09-20",
    weekDay: 7,
    time: { startMinute: 9 * 60, endMinute: 11 * 60 },
    remindable: false,
    metadata: { seatNumber: "18" },
  },
]

describe("buildCalendarSyncEvents & serializeCalendarIcs", () => {
  it("expands term courses, personal events, and exams with timestamps and optional reminders", () => {
    const events = buildCalendarSyncEvents({
      courses,
      extraEntries,
      periods,
      currentWeek,
      calendar,
      timeZone: "Asia/Shanghai",
      includeExams: true,
      examTitlePrefix: "【考试】",
      remindMinutes: 15,
    })

    // 2 weeks of 高等数学 + 2 weeks of 英语晨读 + 1 single-date 社团例会 + 1 exam
    expect(events).toHaveLength(6)
    expect(events[0]).toMatchObject({
      title: "高等数学",
      location: "A101",
      description: "张老师",
      startAt: Date.parse("2026-09-07T08:00:00+08:00"),
      endAt: Date.parse("2026-09-07T09:40:00+08:00"),
      category: "course",
      remindMinutes: 15,
    })
    const weekly = events.find((item) => item.title === "英语晨读")
    expect(weekly?.remindMinutes).toBeUndefined()
    const exam = events.find((item) => item.category === "exam")
    expect(exam).toMatchObject({
      title: "【考试】高等数学期末",
      location: "东区B201",
      description: "座位 18",
      remindMinutes: 15,
    })

    const withoutExams = buildCalendarSyncEvents({
      courses,
      extraEntries,
      periods,
      currentWeek,
      calendar,
      timeZone: "Asia/Shanghai",
      includeExams: false,
    })
    expect(withoutExams.some((item) => item.category === "exam")).toBe(false)
    expect(withoutExams).toHaveLength(5)
  })

  it("serializes RFC 5545 .ics output with escaped text and VALARM", () => {
    const events = buildCalendarSyncEvents({
      courses: [
        {
          ...courses[0]!,
          name: "算法, 结构; 导论",
          weekList: [1],
        },
      ],
      periods,
      currentWeek,
      calendar,
      timeZone: "Asia/Shanghai",
      remindMinutes: 15,
    })
    const ics = serializeCalendarIcs(events, {
      calendarName: "2026-2027-1 日程",
      now: new Date("2026-09-01T00:00:00Z"),
    })

    expect(ics).toContain("BEGIN:VCALENDAR\r\n")
    expect(ics).toContain("X-WR-CALNAME:2026-2027-1 日程\r\n")
    expect(ics).toContain("SUMMARY:算法\\, 结构\\; 导论\r\n")
    expect(ics).toContain("DTSTART:20260907T000000Z\r\n")
    expect(ics).toContain("DTEND:20260907T014000Z\r\n")
    expect(ics).toContain("BEGIN:VALARM\r\n")
    expect(ics).toContain("TRIGGER:-PT15M\r\n")
    expect(ics).toContain("END:VCALENDAR\r\n")
  })
})
