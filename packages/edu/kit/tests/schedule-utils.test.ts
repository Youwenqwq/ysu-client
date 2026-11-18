import type { ClassPeriod, Course, CurrentWeek } from "@orahako/academic-sdk"
import { describe, expect, it } from "vitest"

import {
  buildSectionTimeMap,
  computeMergedBlocks,
  computeWeekDateLabels,
  isCourseActiveInWeek,
  isCourseCurrent,
  isCoursePast,
  parseWeeks,
} from "../src"

const staleCurrentWeek: CurrentWeek = {
  week: 1,
  weekday: 1,
  date: "2026-09-07",
  weekStartDate: "2026-09-07",
  weekDates: [
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
    "2026-09-11",
    "2026-09-12",
    "2026-09-13",
  ],
}

describe("computeWeekDateLabels", () => {
  it("uses the term calendar start date instead of a stale current-week anchor", () => {
    expect(computeWeekDateLabels(staleCurrentWeek, 1, "2026-08-31")).toEqual([
      "8/31",
      "9/1",
      "9/2",
      "9/3",
      "9/4",
      "9/5",
      "9/6",
    ])
    expect(computeWeekDateLabels(staleCurrentWeek, 2, "2026-08-31")).toEqual([
      "9/7",
      "9/8",
      "9/9",
      "9/10",
      "9/11",
      "9/12",
      "9/13",
    ])
  })

  it("falls back to the current-week response without a term calendar date", () => {
    expect(computeWeekDateLabels(staleCurrentWeek, 1)).toEqual([
      "9/7",
      "9/8",
      "9/9",
      "9/10",
      "9/11",
      "9/12",
      "9/13",
    ])
  })

  it("projects a dated snapshot into another browsing week", () => {
    expect(computeWeekDateLabels(staleCurrentWeek, 2)).toEqual([
      "9/14",
      "9/15",
      "9/16",
      "9/17",
      "9/18",
      "9/19",
      "9/20",
    ])
  })

  it("uses a date-only weekday anchor when week dates are unavailable", () => {
    expect(computeWeekDateLabels({ week: 2, weekday: 3, date: "2026-09-16" }, 1)).toEqual([
      "9/7",
      "9/8",
      "9/9",
      "9/10",
      "9/11",
      "9/12",
      "9/13",
    ])
  })

  it("keeps past-term browsing labels from a week-start-only anchor", () => {
    expect(computeWeekDateLabels({ week: 3, weekday: 1, weekStartDate: "2026-09-14" }, 1)).toEqual([
      "8/31",
      "9/1",
      "9/2",
      "9/3",
      "9/4",
      "9/5",
      "9/6",
    ])
  })
})

describe("isCourseActiveInWeek & parseWeeks", () => {
  it("parses Chinese and comma-delimited week strings", () => {
    expect(parseWeeks("第1-3, 5，7-8周")).toEqual([1, 2, 3, 5, 7, 8])
  })

  it("filters school courses by the parsed weeks string when weekList is absent", () => {
    const course: Course = {
      name: "高等数学",
      weeks: "1-8,10-16周",
      weekDay: 1,
      startSection: 1,
      endSection: 2,
    }
    expect(isCourseActiveInWeek(course, 1)).toBe(true)
    expect(isCourseActiveInWeek(course, 8)).toBe(true)
    expect(isCourseActiveInWeek(course, 9)).toBe(false)
    expect(isCourseActiveInWeek(course, 16)).toBe(true)
  })

  it("prefers weekList over the weeks string", () => {
    const course: Course = {
      name: "大学英语",
      weeks: "1-16周",
      weekList: [2],
      weekDay: 2,
      startSection: 3,
      endSection: 4,
    }
    expect(isCourseActiveInWeek(course, 2)).toBe(true)
    expect(isCourseActiveInWeek(course, 1)).toBe(false)
  })

  it("shows courses without week info in every week", () => {
    const noWeeks: Course = { name: "形势与政策", weekDay: 1, startSection: 1, endSection: 2 }
    expect(isCourseActiveInWeek(noWeeks, 5)).toBe(true)
    expect(isCourseActiveInWeek({ ...noWeeks, weeks: "" }, 5)).toBe(true)
  })
})

describe("course time boundaries & merged blocks", () => {
  it("stops highlighting and marks a course past at its end minute", () => {
    const course: Course = { name: "高等数学", weekDay: 1, startSection: 1, endSection: 1 }
    const timeMap: Record<number, [number, number]> = { 1: [480, 525] }

    expect(isCourseCurrent(course, 524, timeMap)).toBe(true)
    expect(isCoursePast(course, 524, timeMap)).toBe(false)
    expect(isCourseCurrent(course, 525, timeMap)).toBe(false)
    expect(isCoursePast(course, 525, timeMap)).toBe(true)
  })

  it("keeps a multi-section course current during the break between its sections", () => {
    const course: Course = { name: "高等数学", weekDay: 1, startSection: 1, endSection: 2 }
    const periods: ClassPeriod[] = [
      { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
      { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
    ]
    const timeMap = buildSectionTimeMap(periods)

    expect(isCourseCurrent(course, 530, timeMap)).toBe(true)
    expect(isCoursePast(course, 530, timeMap)).toBe(false)
    expect(isCourseCurrent(course, 580, timeMap)).toBe(false)
  })

  it("splits partially overlapping courses into distinct merged blocks", () => {
    const periods: ClassPeriod[] = [
      { section: 1, isInUse: true },
      { section: 2, isInUse: true },
      { section: 3, isInUse: true },
    ]
    const blocks = computeMergedBlocks(
      [
        { name: "高数", weekDay: 1, startSection: 1, endSection: 2 },
        { name: "实验", weekDay: 1, startSection: 2, endSection: 3 },
      ],
      periods
    )
    expect(blocks.map((b) => [b.start, b.end, b.courses.map((c) => c.name)])).toEqual([
      [1, 1, ["高数"]],
      [2, 2, ["高数", "实验"]],
      [3, 3, ["实验"]],
    ])
  })
})
