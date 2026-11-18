import type { ClassPeriod, Course, CurrentWeek, Exam, TermCalendar } from "@orahako/academic-sdk"
import { describe, expect, it } from "vitest"

import { computeOverviewSchedule, formatMinutesClock } from "../src"

const calendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-08-31",
  totalWeeks: 20,
  teachingWeeks: 18,
  isInUse: true,
}

const periods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
  { section: 3, startTime: "10:00", endTime: "10:45", isInUse: true },
  { section: 4, startTime: "10:55", endTime: "11:40", isInUse: true },
  { section: 99, startTime: "22:00", endTime: "23:00", isInUse: false },
]

const courses: Course[] = [
  { name: "大学英语", weekDay: 1, startSection: 3, endSection: 4, weekList: [1, 2] },
  { name: "高等数学", weekDay: 1, startSection: 1, endSection: 2, weekList: [1] },
  { name: "线性代数", weekDay: 2, startSection: 1, endSection: 2, weekList: [1] },
]

const exams: Exam[] = [
  { name: "已结束考试", startAt: "2026-08-30T09:00:00", endAt: "2026-08-30T11:00:00" },
  { name: "期末线代", startAt: "2026-12-29T14:00:00", endAt: "2026-12-29T16:00:00" },
  { name: "期末高数", startAt: "2026-12-28T09:00:00", endAt: "2026-12-28T11:00:00" },
]

const currentWeek: CurrentWeek = {
  semester: "2026-2027-1",
  week: 1,
  weekday: 1,
  date: "2026-08-31",
}

describe("computeOverviewSchedule", () => {
  it("computes ongoing course, sorted today courses, and upcoming exams purely", () => {
    // 2026-08-31 08:30 Shanghai = 2026-08-31T00:30:00Z
    const snapshot = computeOverviewSchedule({
      courses,
      exams,
      periods,
      currentWeek,
      calendar,
      now: new Date("2026-08-31T00:30:00Z"),
    })

    expect(snapshot.todayCourses.map((c) => c.name)).toEqual(["高等数学", "大学英语"])
    expect(snapshot.currentCourse?.name).toBe("高等数学")
    expect(snapshot.currentRange).toEqual([480, 580])
    expect(snapshot.nextCourseInfo).toBeNull()
    expect(snapshot.upcomingExams.map((e) => e.name)).toEqual(["期末高数", "期末线代"])
    expect(snapshot.periods).toHaveLength(4)
    expect(formatMinutesClock(snapshot.currentRange![0])).toBe("8:00")
  })

  it("computes nextCourseInfo during break when no course is currently running", () => {
    // 2026-08-31 09:50 Shanghai = 2026-08-31T01:50:00Z
    const snapshot = computeOverviewSchedule({
      courses,
      periods,
      currentWeek,
      calendar,
      now: new Date("2026-08-31T01:50:00Z"),
    })

    expect(snapshot.currentCourse).toBeNull()
    expect(snapshot.nextCourseInfo?.course.name).toBe("大学英语")
    expect(snapshot.nextCourseInfo?.range).toEqual([600, 700])
  })

  it("returns empty todayCourses outside term weeks", () => {
    const snapshot = computeOverviewSchedule({
      courses,
      periods,
      currentWeek: null,
      calendar,
      now: new Date("2026-08-25T02:00:00Z"),
    })
    expect(snapshot.liveWeek).toBeNull()
    expect(snapshot.todayCourses).toEqual([])
    expect(snapshot.currentCourse).toBeNull()
    expect(snapshot.nextCourseInfo).toBeNull()
  })
})
