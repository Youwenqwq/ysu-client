import { describe, expect, it } from "vitest"
import type { ClassPeriod, Exam } from "@/providers/types"
import { computeExamBlocks } from "./exam-blocks"

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

describe("computeExamBlocks", () => {
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
      "2026-08-31"
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
      2
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
      "2026-08-31"
    )

    expect(blocks).toMatchObject([{ day: 7, start: 4, end: 4 }])
  })
})
