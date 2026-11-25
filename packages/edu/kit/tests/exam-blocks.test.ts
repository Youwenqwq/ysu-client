import type { ClassPeriod, Exam } from "@orahako/academic-sdk"
import { describe, expect, it } from "vitest"

import { compareExamStartTime, computeExamBlocks, formatExamTime, isExamCompleted } from "../src"

const periods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
  { section: 3, startTime: "09:50", endTime: "10:35", isInUse: true },
  { section: 4, startTime: "14:00", endTime: "14:45", isInUse: true },
]

function makeExam(overrides: Partial<Exam>): Exam {
  return {
    name: "高等数学",
    ...overrides,
  }
}

describe("computeExamBlocks & exam-utils", () => {
  it("maps local datetime fields when timestamps are absent", () => {
    const blocks = computeExamBlocks(
      [
        makeExam({
          startAt: "2026-09-09T09:30:00",
          endAt: "2026-09-09T10:20:00",
        }),
      ],
      periods,
      null,
      2,
      "2026-08-31",
      "Asia/Shanghai"
    )

    expect(blocks).toMatchObject([{ day: 3, start: 2, end: 3 }])
  })

  it("places absolute timestamps in Shanghai exam days and periods", () => {
    const blocks = computeExamBlocks(
      [
        makeExam({
          startTimestamp: Date.parse("2026-09-09T01:30:00Z"),
          endTimestamp: Date.parse("2026-09-09T02:20:00Z"),
        }),
        makeExam({
          startTimestamp: Date.parse("2026-09-06T16:30:00Z"),
          endTimestamp: Date.parse("2026-09-06T17:00:00Z"),
        }),
      ],
      periods,
      { week: 1, weekday: 1, date: "2026-08-31" },
      2,
      undefined,
      "Asia/Shanghai"
    )

    expect(blocks).toMatchObject([
      { day: 3, start: 2, end: 3 },
      { day: 1, start: 1, end: 1 },
    ])
  })

  it("falls back to the start time and clamps exams outside the timetable", () => {
    const blocks = computeExamBlocks(
      [
        makeExam({
          name: "英语考试",
          startAt: "2026-09-13T19:00:00",
        }),
      ],
      periods,
      null,
      2,
      "2026-08-31",
      "Asia/Shanghai"
    )

    expect(blocks).toMatchObject([{ day: 7, start: 4, end: 4 }])
  })

  it("sorts, checks completion, and formats exam times", () => {
    const first = makeExam({
      name: "线代",
      startAt: "2026-09-09T09:00:00",
      endAt: "2026-09-09T11:00:00",
    })
    const second = makeExam({
      name: "英语",
      startAt: "2026-09-10T14:00:00",
      endAt: "2026-09-10T16:00:00",
      timeText: "14:00 ~ 16:00",
    })
    expect(
      [second, first]
        .sort((a, b) => compareExamStartTime(a, b, "Asia/Shanghai"))
        .map((e) => e.name)
    ).toEqual(["线代", "英语"])
    expect(isExamCompleted(first, new Date("2026-09-09T04:00:00Z"), "Asia/Shanghai")).toBe(true)
    expect(isExamCompleted(second, new Date("2026-09-09T04:00:00Z"), "Asia/Shanghai")).toBe(false)
    expect(formatExamTime(first)).toBe("09:00-11:00")
    expect(formatExamTime(second)).toBe("14:00 ~ 16:00")
  })
})
