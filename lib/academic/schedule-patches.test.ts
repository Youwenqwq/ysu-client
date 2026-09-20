import { describe, expect, it } from "vitest"
import type { Course } from "@/providers/types"
import {
  expandScheduleCourses,
  resolveSchedulePatches,
  resolveScheduleTerm,
  scheduleDate,
  schedulePatchAffectsWeek,
  schedulePatchDependents,
  scheduleWeek,
  type ScheduleOccurrence,
  type SchedulePatch,
} from "./schedule-patches"

const start = "2026-08-31"
const monday = start
const tuesday = "2026-09-01"
const raw: Course[] = [
  {
    name: "Math",
    scheduleId: "math",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weekList: [1, 2],
  },
  {
    name: "Physics",
    scheduleId: "physics",
    weekDay: 2,
    startSection: 3,
    endSection: 4,
    weekList: [1],
  },
]
const occurrences = expandScheduleCourses(raw, start, 3)
const source = occurrences.find((course) => course.date === monday)!
const target = occurrences.find((course) => course.date === tuesday)!
function patch(overrides: Partial<SchedulePatch> = {}): SchedulePatch {
  return {
    id: "a",
    kind: "course",
    mode: "copy",
    sourceDate: monday,
    targetDate: tuesday,
    targetStartSection: 5,
    note: "",
    createdAt: "2026-08-30T12:00:00Z",
    enabled: true,
    source: [source],
    replaced: [],
    dependsOn: [],
    ...overrides,
  }
}
function slots(courses: ScheduleOccurrence[]) {
  return courses.map((course) => [course.name, course.date, course.startSection, course.weekList])
}

describe("schedule patches", () => {
  it("counts cross-week changes only where each operation changes the schedule", () => {
    const dates = { sourceDate: "2026-09-21", targetDate: "2026-09-20" }
    const affectedWeeks = (adjustment: SchedulePatch) =>
      [2, 3, 4, 5].filter((week) => schedulePatchAffectsWeek(adjustment, start, week))

    expect(affectedWeeks(patch({ ...dates, mode: "copy" }))).toEqual([3])
    expect(affectedWeeks(patch({ ...dates, mode: "move" }))).toEqual([3, 4])
    expect(affectedWeeks(patch({ ...dates, mode: "clear" }))).toEqual([4])
    expect(affectedWeeks(patch({ ...dates, enabled: false }))).toEqual([])
  })

  it("copies one dated occurrence without repeating it in the source's other weeks", () => {
    const result = resolveSchedulePatches(raw, start, 3, [patch()])
    expect(slots(result.courses)).toEqual([
      ["Math", monday, 1, [1]],
      ["Physics", tuesday, 3, [1]],
      ["Math", tuesday, 5, [1]],
      ["Math", "2026-09-07", 1, [2]],
    ])
    expect(result.courses.find((course) => course.patchIds.length)?.source).toEqual(source.source)
    expect(result.traces).toEqual([])
  })

  it("moves only the exact occurrence and keeps its original detail-query provenance", () => {
    const result = resolveSchedulePatches(raw, start, 3, [patch({ mode: "move" })])
    expect(slots(result.courses)).toEqual([
      ["Physics", tuesday, 3, [1]],
      ["Math", tuesday, 5, [1]],
      ["Math", "2026-09-07", 1, [2]],
    ])
    expect(result.courses.find((course) => course.patchIds.length)?.source).toEqual(source.source)
    expect(result.traces).toEqual([
      {
        patchId: "a",
        date: monday,
        startSection: 1,
        endSection: 2,
        kind: "moved",
        name: "Math",
        targetDate: tuesday,
      },
    ])
    expect(raw[0].weekList).toEqual([1, 2])
  })

  it("replaces the confirmed target day before an individual dependent move", () => {
    const day = patch({ kind: "day", replaced: [target] })
    const dayResult = resolveSchedulePatches(raw, start, 3, [day])
    const copied = dayResult.courses.find((course) => course.patchIds.includes(day.id))!
    const move = patch({
      id: "b",
      mode: "move",
      sourceDate: tuesday,
      targetDate: "2026-09-02",
      source: [copied],
      dependsOn: [day.id],
    })
    const result = resolveSchedulePatches(raw, start, 3, [move, day])
    expect(slots(result.courses)).toEqual([
      ["Math", monday, 1, [1]],
      ["Math", "2026-09-02", 5, [1]],
      ["Math", "2026-09-07", 1, [2]],
    ])
    expect(result.issues).toEqual([])
    expect(result.traces.map((trace) => trace.kind)).toEqual(["replaced", "moved"])
  })

  it("moves a day, clearing its source and replacing only the target date", () => {
    const result = resolveSchedulePatches(raw, start, 3, [
      patch({ kind: "day", mode: "move", replaced: [target] }),
    ])
    expect(slots(result.courses)).toEqual([
      ["Math", tuesday, 1, [1]],
      ["Math", "2026-09-07", 1, [2]],
    ])
    expect(result.traces.map((trace) => trace.kind)).toEqual(["moved", "replaced"])
  })

  it("undoes a dependency chain without removing an independent patch", () => {
    const first = patch()
    const copied = resolveSchedulePatches(raw, start, 3, [first]).courses.find(
      (course) => course.patchIds.length
    )!
    const second = patch({
      id: "b",
      source: [copied],
      sourceDate: tuesday,
      targetDate: "2026-09-02",
      dependsOn: [first.id],
    })
    const third = patch({ id: "c", dependsOn: [second.id] })
    const independent = patch({ id: "d", targetDate: "2026-09-03" })
    const patches = [first, second, third, independent]
    const removed = new Set([first.id, ...schedulePatchDependents(patches, first.id)])
    expect([...removed]).toEqual(["a", "b", "c"])
    expect(
      resolveSchedulePatches(
        raw,
        start,
        3,
        patches.filter((item) => !removed.has(item.id))
      ).courses
    ).toEqual(resolveSchedulePatches(raw, start, 3, [independent]).courses)
    expect(
      resolveSchedulePatches(raw, start, 3, [{ ...first, enabled: false }, second]).issues
    ).toContainEqual({ patchId: "b", reason: "missingDependency" })
  })

  it("uses the confirmed snapshot when upstream disappears or changes, without name matching", () => {
    const move = patch({ mode: "move" })
    const missing = resolveSchedulePatches([raw[1]], start, 3, [move])
    expect(slots(missing.courses)).toEqual([
      ["Physics", tuesday, 3, [1]],
      ["Math", tuesday, 5, [1]],
    ])
    expect(missing.issues).toContainEqual({ patchId: "a", reason: "sourceMissing" })
    const changed = resolveSchedulePatches(
      [{ ...raw[0], startSection: 7, endSection: 8 }, raw[1]],
      start,
      3,
      [move]
    )
    expect(changed.issues).toContainEqual({ patchId: "a", reason: "sourceMissing" })
    expect(changed.courses.find((course) => course.patchIds.length)?.startSection).toBe(5)
    expect(changed.courses.find((course) => course.date === monday)?.startSection).toBe(7)
  })

  it("follows live classroom and teacher updates unless the patch overrides the classroom", () => {
    const fresh = [{ ...raw[0], classroom: "New room", teacher: "New teacher" }, raw[1]]
    const live = resolveSchedulePatches(fresh, start, 3, [patch({ mode: "move" })])
    expect(live.courses.find((course) => course.patchIds.length)).toMatchObject({
      classroom: "New room",
      teacher: "New teacher",
    })
    expect(live.issues).toEqual([])
    const overridden = resolveSchedulePatches(fresh, start, 3, [
      patch({ mode: "move", classroom: "My room" }),
    ])
    expect(overridden.courses.find((course) => course.patchIds.length)).toMatchObject({
      classroom: "My room",
      teacher: "New teacher",
    })
  })

  it("does not duplicate a uniquely identified upstream move already at the patched destination", () => {
    const fresh = [{ ...raw[0], weekDay: 2, startSection: 5, endSection: 6, weekList: [1] }, raw[1]]
    const result = resolveSchedulePatches(fresh, start, 3, [patch({ mode: "move" })])
    expect(slots(result.courses)).toEqual([
      ["Physics", tuesday, 3, [1]],
      ["Math", tuesday, 5, [1]],
    ])
    expect(result.issues).toEqual([{ patchId: "a", reason: "alreadyApplied" }])
    expect(result.courses.find((course) => course.patchIds.length)?.source).toEqual(source.source)
  })

  it("does not delete ambiguous source rows and reports the snapshot fallback", () => {
    const result = resolveSchedulePatches(
      [raw[0], { ...raw[0], classroom: "Other room" }],
      start,
      3,
      [patch({ mode: "move" })]
    )
    expect(
      result.courses.filter((course) => course.date === monday).map((course) => course.classroom)
    ).toEqual([undefined, "Other room"])
    expect(result.courses.find((course) => course.date === tuesday)?.source).toEqual(source.source)
    expect(result.issues).toContainEqual({ patchId: "a", reason: "sourceAmbiguous" })
  })

  it("blocks stale whole-day replacement rather than deleting newly arrived target courses", () => {
    const fresh = [
      ...raw,
      { ...raw[1], scheduleId: "new", name: "New class", startSection: 7, endSection: 8 },
    ]
    const result = resolveSchedulePatches(fresh, start, 3, [
      patch({ kind: "day", mode: "move", replaced: [target] }),
    ])
    expect(result.courses).toEqual(resolveSchedulePatches(fresh, start, 3, []).courses)
    expect(result.issues).toContainEqual({ patchId: "a", reason: "targetChanged" })
    expect(result.traces).toEqual([])
  })

  it("keeps single-course overlaps additive and rejects repeated destructive use of a source", () => {
    const overlap = patch({ mode: "move", targetStartSection: 3 })
    const result = resolveSchedulePatches(raw, start, 3, [
      overlap,
      patch({ id: "b", mode: "move" }),
    ])
    expect(
      result.courses
        .filter((course) => course.date === tuesday)
        .map((course) => course.name)
        .sort()
    ).toEqual(["Math", "Physics"])
    expect(result.issues).toEqual([
      { patchId: "a", reason: "targetOverlap" },
      { patchId: "b", reason: "patchConflict" },
    ])
  })

  it("removes a singleton entirely instead of leaving an all-weeks empty weekList", () => {
    const result = resolveSchedulePatches([raw[1]], start, 3, [
      patch({ source: [target], sourceDate: tuesday, targetDate: tuesday, mode: "clear" }),
    ])
    expect(result.courses).toEqual([])
    expect(result.traces[0].kind).toBe("cleared")
    expect(resolveSchedulePatches([raw[1]], start, 3, []).courses).toEqual([target])
  })

  it("is deterministic across provider row order and repeated resolution", () => {
    const patches = [patch({ mode: "move" })]
    expect(resolveSchedulePatches([...raw].reverse(), start, 3, patches)).toEqual(
      resolveSchedulePatches(raw, start, 3, patches)
    )
    const sameName = expandScheduleCourses(
      [
        { ...raw[0], scheduleId: undefined, teacher: "A" },
        { ...raw[0], scheduleId: undefined, teacher: "B" },
      ],
      start,
      1
    )
    const result = resolveSchedulePatches(
      sameName.map((course) => course.source.course),
      start,
      1,
      [patch({ source: [sameName[0]], mode: "move" })]
    )
    expect(
      result.courses.filter((course) => course.date === monday).map((course) => course.teacher)
    ).toEqual(["B"])
    expect(
      result.courses.filter((course) => course.date === tuesday).map((course) => course.teacher)
    ).toEqual(["A"])
  })

  it("rejects targets outside the term and resolves academic dates without UTC parsing", () => {
    const result = resolveSchedulePatches(raw, start, 3, [patch({ targetDate: "2026-09-21" })])
    expect(result.issues).toEqual([{ patchId: "a", reason: "invalidDate" }])
    expect(result.courses).toEqual(resolveSchedulePatches(raw, start, 3, []).courses)
    expect(scheduleDate("2026-03-02", 2, 1)).toBe("2026-03-09")
    expect(scheduleWeek("2026-03-09", "2026-03-02")).toEqual({ week: 2, weekday: 1 })
    expect(scheduleWeek("2026-02-30", start)).toEqual({ week: 0, weekday: 0 })
    const calendar = { startDate: start, totalWeeks: 18, teachingWeeks: 20, isInUse: true }
    expect(resolveScheduleTerm(calendar, null)).toBeNull()
    expect(resolveScheduleTerm(calendar, { week: 1, weekday: 1, semester: "2026-1" })).toEqual({
      semester: "2026-1",
      termStartDate: start,
      totalWeeks: 20,
    })
    expect(resolveScheduleTerm({ ...calendar, semester: "2026-1" }, null, "2025-1")).toBeNull()
  })
})
