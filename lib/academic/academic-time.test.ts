import { describe, expect, it } from "vitest"
import type { CurrentWeek, TermCalendar } from "@/providers/types"
import { getAcademicClock, resolveAcademicWeek } from "./academic-time"
import { getExamStartTime } from "./exam-utils"

const calendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-08-31",
  totalWeeks: 20,
  teachingWeeks: 18,
  isInUse: true,
}
const cached: CurrentWeek = {
  semester: calendar.semester,
  week: 5,
  weekday: 5,
  date: "2026-10-02",
  weekStartDate: "2026-09-28",
  weekEndDate: "2026-10-04",
}

describe("live academic time", () => {
  it("uses Shanghai midnight even when the device's date is still Sunday", () => {
    expect(getAcademicClock(new Date("2026-10-04T15:59:00Z"))).toEqual({
      date: "2026-10-04",
      weekday: 7,
      minutes: 1439,
    })
    expect(getAcademicClock(new Date("2026-10-04T16:00:00Z"))).toEqual({
      date: "2026-10-05",
      weekday: 1,
      minutes: 0,
    })
  })

  it("advances stale Friday cache to Monday without mutating the cached response", () => {
    const live = resolveAcademicWeek(Object.freeze(cached), calendar, "2026-10-05")
    expect(live).toEqual({
      semester: calendar.semester,
      week: 6,
      weekday: 1,
      date: "2026-10-05",
      weekStartDate: "2026-10-05",
      weekEndDate: "2026-10-11",
      weekDates: [
        "2026-10-05",
        "2026-10-06",
        "2026-10-07",
        "2026-10-08",
        "2026-10-09",
        "2026-10-10",
        "2026-10-11",
      ],
    })
    expect(cached.date).toBe("2026-10-02")
    expect(cached.week).toBe(5)
  })

  it("uses the calendar instead of a conflicting snapshot anchor, even without a current-week response", () => {
    const wrongAnchor = { ...cached, week: 1, weekStartDate: "2026-09-28" }
    expect(resolveAcademicWeek(wrongAnchor, calendar, "2026-10-05")?.week).toBe(6)
    expect(resolveAcademicWeek(null, calendar, "2026-10-05")?.week).toBe(6)
  })

  it("can advance a dated snapshot when the calendar start date is absent", () => {
    const noStart = { ...calendar, startDate: undefined }
    expect(resolveAcademicWeek(cached, noStart, "2026-10-05")?.week).toBe(6)
    expect(
      resolveAcademicWeek({ ...cached, weekStartDate: undefined }, noStart, "2026-10-05")
    ).toEqual(resolveAcademicWeek(cached, noStart, "2026-10-05"))
  })

  it("does not fabricate a current week from a bare number or an invalid date anchor", () => {
    expect(resolveAcademicWeek({ week: 5, weekday: 5 }, undefined, "2026-10-05")).toBeNull()
    expect(
      resolveAcademicWeek({ ...cached, weekStartDate: "2026-02-30" }, undefined, "2026-10-05")
    ).toBeNull()
    expect(resolveAcademicWeek(null, calendar, "2026-02-30")).toBeNull()
  })

  it("does not clamp holidays to the first or last week of a semester", () => {
    expect(resolveAcademicWeek(cached, calendar, "2026-08-30")).toBeNull()
    expect(resolveAcademicWeek(cached, calendar, "2026-08-31")?.week).toBe(1)
    expect(resolveAcademicWeek(cached, calendar, "2027-01-17")?.week).toBe(20)
    expect(resolveAcademicWeek(cached, calendar, "2027-01-18")).toBeNull()
    expect(resolveAcademicWeek(cached, { ...calendar, totalWeeks: 5 }, "2026-10-05")).toBeNull()
  })

  it("does not combine asynchronously refreshed metadata from different semesters", () => {
    const old = { ...cached, semester: "2025-2026-2" }
    expect(resolveAcademicWeek(old, calendar, "2026-10-05")).toBeNull()
    expect(resolveAcademicWeek(old, calendar, "2026-10-05", calendar.semester)?.week).toBe(6)
    expect(resolveAcademicWeek(cached, calendar, "2026-10-05", "2027-2028-1")).toBeNull()
  })

  it("interprets offset-less exam time in the same school timezone but preserves explicit instants", () => {
    expect(getExamStartTime({ name: "考试", startAt: "2026-10-05T08:00:00" })?.toISOString()).toBe(
      "2026-10-05T00:00:00.000Z"
    )
    expect(getExamStartTime({ name: "考试", startAt: "2026-10-05T08:00:00Z" })?.toISOString()).toBe(
      "2026-10-05T08:00:00.000Z"
    )
  })
})
