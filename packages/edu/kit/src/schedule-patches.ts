import type { Course, CurrentWeek, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleDeliveryMode } from "@orahako/sdk"

import { isCourseActiveInWeek } from "./schedule-utils"

export interface CourseOverride {
  /** Matches `courseIdentity(rawCourse)`. */
  readonly courseKey: string
  /** Snapshot display name for management UI even if upstream course disappears. */
  readonly originalName: string
  /** When true, hides this entire course from timetable, overview, reminders, and widgets. */
  readonly hidden?: boolean
  readonly name?: string
  readonly classroom?: string
  readonly teacher?: string
  readonly weekDay?: number
  readonly startSection?: number
  readonly endSection?: number
  readonly weekList?: readonly number[]
  readonly deliveryMode?: ScheduleDeliveryMode
  readonly note?: string
  readonly updatedAt: string
}

export interface ScheduleOccurrence extends Course {
  occurrenceId: string
  date: string
  source: { course: Course; week: number; date: string }
  patchIds: string[]
  /** Stable logical course identity key (from `courseIdentity(rawCourse)`). */
  courseKey?: string
  /** True when a course-level override was applied to this occurrence. */
  overridden?: boolean
  /** Present when this occurrence comes from a user-created custom course. */
  customItemId?: string
}

export function isScheduleOccurrence(course: Course): course is ScheduleOccurrence {
  return (
    "occurrenceId" in course &&
    typeof course.occurrenceId === "string" &&
    "date" in course &&
    typeof course.date === "string" &&
    "source" in course &&
    typeof course.source === "object" &&
    course.source !== null &&
    "patchIds" in course &&
    Array.isArray(course.patchIds)
  )
}

export function scheduleOccurrence(course: Course): ScheduleOccurrence | null {
  return isScheduleOccurrence(course) ? course : null
}

export interface SchedulePatch {
  id: string
  kind: "course" | "day"
  mode: "copy" | "move" | "clear"
  sourceDate: string
  targetDate: string
  targetStartSection?: number
  classroom?: string
  deliveryMode?: ScheduleDeliveryMode
  note: string
  createdAt: string
  enabled: boolean
  source: ScheduleOccurrence[]
  replaced: ScheduleOccurrence[]
  dependsOn: string[]
}

export interface ScheduleTrace {
  patchId: string
  date: string
  startSection: number
  endSection: number
  kind: "moved" | "replaced" | "cleared"
  name: string
  targetDate: string
}

export interface ScheduleIssue {
  patchId: string
  reason:
    | "invalidDate"
    | "invalidSections"
    | "missingDependency"
    | "dependencyCycle"
    | "sourceMissing"
    | "sourceChanged"
    | "sourceAmbiguous"
    | "targetChanged"
    | "patchConflict"
    | "targetOverlap"
    | "alreadyApplied"
}

export interface ScheduleSelection {
  kind: "course" | "day"
  date: string
  courses: ScheduleOccurrence[]
}

export interface ScheduleDrop {
  selection: ScheduleSelection
  targetDate: string
  targetStartSection: number
}

function localDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|T| )/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 12)
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : null
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function scheduleDate(termStartDate: string, week: number, weekday: number): string {
  const start = localDate(termStartDate)
  if (!start || !Number.isInteger(week) || !Number.isInteger(weekday)) return ""
  start.setDate(start.getDate() + (week - 1) * 7 + weekday - 1)
  return dateString(start)
}

export function scheduleWeek(
  date: string,
  termStartDate: string
): { week: number; weekday: number } {
  const start = localDate(termStartDate)
  const day = localDate(date)
  if (!start || !day) return { week: 0, weekday: 0 }
  const days = Math.round((day.getTime() - start.getTime()) / 86_400_000)
  return { week: Math.floor(days / 7) + 1, weekday: (((days % 7) + 7) % 7) + 1 }
}

/** Copy leaves the source unchanged; cancellation never changes the destination. */
export function schedulePatchAffectsWeek(
  patch: SchedulePatch,
  termStartDate: string,
  week: number
): boolean {
  if (!patch.enabled || !termStartDate || week < 1) return false
  return (
    (patch.mode !== "copy" && scheduleWeek(patch.sourceDate, termStartDate).week === week) ||
    (patch.mode !== "clear" && scheduleWeek(patch.targetDate, termStartDate).week === week)
  )
}

export function resolveScheduleTerm(
  calendar: TermCalendar | undefined,
  currentWeek: CurrentWeek | null,
  requestedSemester?: string
): { semester: string; termStartDate: string; totalWeeks: number } | null {
  if (!calendar) return null
  const semester =
    requestedSemester?.trim() || calendar.semester?.trim() || currentWeek?.semester?.trim()
  if (!semester || (calendar.semester && calendar.semester !== semester)) return null
  const totalWeeks = Math.max(calendar.totalWeeks || 0, calendar.teachingWeeks || 0)
  if (!Number.isInteger(totalWeeks) || totalWeeks < 1) return null
  let start = calendar.startDate ? localDate(calendar.startDate) : null
  if (!start && currentWeek?.semester === semester && currentWeek.week >= 1) {
    const anchor = currentWeek.weekStartDate || currentWeek.weekDates?.[0]
    const date = anchor ? localDate(anchor) : currentWeek.date ? localDate(currentWeek.date) : null
    if (date) {
      date.setDate(
        date.getDate() - (currentWeek.week - 1) * 7 - (anchor ? 0 : currentWeek.weekday - 1)
      )
      start = date
    }
  }
  return start ? { semester, termStartDate: dateString(start), totalWeeks } : null
}

export function formatWeekList(weeks: readonly number[]): string {
  const sorted = [...new Set(weeks.filter((w) => Number.isInteger(w) && w >= 1))].sort(
    (a, b) => a - b
  )
  if (sorted.length === 0) return ""
  const ranges: string[] = []
  let start = sorted[0]!
  let prev = start
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]!
    if (current === prev + 1) {
      prev = current
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
      start = current
      prev = current
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
  return ranges.join(", ")
}

export function courseIdentity(course: Course): string {
  const slot = [course.weekDay, course.startSection, course.endSection]
  return JSON.stringify(
    course.scheduleId
      ? [
          "id",
          course.scheduleId,
          course.classId ?? "",
          course.syxzdm ?? "",
          course.classType ?? "",
          ...slot,
        ]
      : [
          "composite",
          course.classId ?? "",
          course.code ?? "",
          course.name,
          course.teacher ?? "",
          course.classroom ?? "",
          course.courseType ?? "",
          course.classType ?? "",
          course.syxzdm ?? "",
          ...slot,
        ]
  )
}

export interface AppliedCourseRecord {
  readonly course: Course
  readonly originalCourse: Course
  readonly courseKey: string
  readonly overridden: boolean
  readonly customItemId?: string
}

export function applyCourseOverrides(
  rawCourses: readonly Course[],
  overrides: readonly CourseOverride[],
  customCourses: readonly Course[] = []
): AppliedCourseRecord[] {
  const overrideMap = new Map(overrides.map((item) => [item.courseKey, item]))
  const records: AppliedCourseRecord[] = []

  for (const rawCourse of rawCourses) {
    const key = courseIdentity(rawCourse)
    const override = overrideMap.get(key)
    if (override?.hidden) continue

    if (!override) {
      records.push({
        course: rawCourse,
        originalCourse: rawCourse,
        courseKey: key,
        overridden: false,
      })
      continue
    }

    const overriddenWeekList =
      override.weekList && override.weekList.length > 0
        ? [...new Set(override.weekList.filter((w) => Number.isInteger(w) && w >= 1))].sort(
            (a, b) => a - b
          )
        : undefined
    const merged: Course = {
      ...rawCourse,
      ...(override.name !== undefined ? { name: override.name } : {}),
      ...(override.classroom !== undefined ? { classroom: override.classroom } : {}),
      ...(override.teacher !== undefined ? { teacher: override.teacher } : {}),
      ...(override.weekDay !== undefined ? { weekDay: override.weekDay } : {}),
      ...(override.startSection !== undefined ? { startSection: override.startSection } : {}),
      ...(override.endSection !== undefined ? { endSection: override.endSection } : {}),
      ...(overriddenWeekList
        ? { weekList: overriddenWeekList, weeks: formatWeekList(overriddenWeekList) }
        : {}),
      ...(override.deliveryMode !== undefined ? { deliveryMode: override.deliveryMode } : {}),
      ...(override.note !== undefined ? { note: override.note } : {}),
    }
    records.push({
      course: merged,
      originalCourse: rawCourse,
      courseKey: key,
      overridden: true,
    })
  }

  for (const custom of customCourses) {
    const customItemId = custom.scheduleId?.startsWith("custom:")
      ? custom.scheduleId.slice("custom:".length)
      : custom.scheduleId
    records.push({
      course: custom,
      originalCourse: custom,
      courseKey: courseIdentity(custom),
      overridden: false,
      ...(customItemId ? { customItemId } : {}),
    })
  }

  return records
}

function occurrenceSignature(course: ScheduleOccurrence): string {
  return JSON.stringify([
    course.date,
    course.startSection,
    course.endSection,
    course.classId,
    course.scheduleId,
    course.syxzdm,
    course.classType,
  ])
}

export function expandScheduleCourses(
  courses: readonly Course[],
  termStartDate: string,
  totalWeeks: number,
  options?: {
    readonly overrides?: readonly CourseOverride[]
    readonly customCourses?: readonly Course[]
  }
): ScheduleOccurrence[] {
  const applied =
    options?.overrides?.length || options?.customCourses?.length
      ? applyCourseOverrides(courses, options.overrides ?? [], options.customCourses ?? [])
      : courses.map((course) => ({
          course,
          originalCourse: course,
          courseKey: courseIdentity(course),
          overridden: false,
          customItemId: course.scheduleId?.startsWith("custom:")
            ? course.scheduleId.slice("custom:".length)
            : undefined,
        }))

  const result: ScheduleOccurrence[] = []
  for (const record of applied) {
    const { course, courseKey, overridden, customItemId } = record
    if (!Number.isInteger(course.weekDay) || course.weekDay < 1 || course.weekDay > 7) continue
    for (let week = 1; week <= totalWeeks; week++) {
      if (!isCourseActiveInWeek(course, week)) continue
      const date = scheduleDate(termStartDate, week, course.weekDay)
      result.push({
        ...course,
        weeks: String(week),
        weekList: [week],
        occurrenceId: JSON.stringify([courseKey, date]),
        date,
        source: { course, week, date },
        patchIds: [],
        courseKey,
        ...(overridden ? { overridden: true } : {}),
        ...(customItemId ? { customItemId } : {}),
      })
    }
  }
  return result
}

/** Transitive dependents, excluding the operation itself. */
export function schedulePatchDependents(patches: readonly SchedulePatch[], id: string): string[] {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const patch of patches) {
      if (!ids.has(patch.id) && patch.dependsOn.some((dependency) => ids.has(dependency))) {
        ids.add(patch.id)
        changed = true
      }
    }
  }
  return [...ids].filter((dependency) => dependency !== id)
}

export function resolveSchedulePatches(
  rawCourses: readonly Course[],
  termStartDate: string,
  totalWeeks: number,
  patches: readonly SchedulePatch[],
  options?: {
    readonly overrides?: readonly CourseOverride[]
    readonly customCourses?: readonly Course[]
  }
): { courses: ScheduleOccurrence[]; traces: ScheduleTrace[]; issues: ScheduleIssue[] } {
  let courses = expandScheduleCourses(rawCourses, termStartDate, totalWeeks, options)
  const traces: ScheduleTrace[] = []
  const issues: ScheduleIssue[] = []
  const issue = (patch: SchedulePatch, reason: ScheduleIssue["reason"]) => {
    if (!issues.some((item) => item.patchId === patch.id && item.reason === reason)) {
      issues.push({ patchId: patch.id, reason })
    }
  }
  const pending = patches
    .filter((patch) => patch.enabled)
    .sort(
      (a, b) =>
        Number(b.kind === "day") - Number(a.kind === "day") ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    )
  const enabledIds = new Set(pending.map((patch) => patch.id))
  const applied = new Set<string>()
  const consumed = new Map<string, string>()
  const inTerm = (date: string) => {
    const week = scheduleWeek(date, termStartDate).week
    return week >= 1 && week <= totalWeeks
  }
  const trace = (patch: SchedulePatch, course: ScheduleOccurrence, kind: ScheduleTrace["kind"]) => {
    traces.push({
      patchId: patch.id,
      date: course.date,
      startSection: course.startSection,
      endSection: course.endSection,
      kind,
      name: course.name,
      targetDate: patch.targetDate,
    })
  }

  while (pending.length) {
    const index = pending.findIndex((patch) =>
      patch.dependsOn.every(
        (id) => applied.has(id) || !pending.some((candidate) => candidate.id === id)
      )
    )
    if (index < 0) {
      for (const patch of pending) issue(patch, "dependencyCycle")
      break
    }
    const [patch] = pending.splice(index, 1)
    if (!patch) break
    if (patch.dependsOn.some((id) => !enabledIds.has(id) || !applied.has(id))) {
      issue(patch, "missingDependency")
      continue
    }
    if (
      !inTerm(patch.sourceDate) ||
      !inTerm(patch.targetDate) ||
      patch.source.some((item) => item.date !== patch.sourceDate)
    ) {
      issue(patch, "invalidDate")
      continue
    }
    if (patch.kind === "course" && patch.source.length !== 1) {
      issue(patch, "sourceAmbiguous")
      continue
    }
    const sourceIds = new Set(patch.source.map((item) => item.occurrenceId))
    if (sourceIds.size !== patch.source.length) {
      issue(patch, "sourceAmbiguous")
      continue
    }
    if (patch.source.some((item) => consumed.has(item.occurrenceId))) {
      issue(patch, "patchConflict")
      continue
    }
    if (
      patch.kind === "day" &&
      courses.some((item) => item.date === patch.sourceDate && !sourceIds.has(item.occurrenceId))
    ) {
      issue(patch, "sourceChanged")
    }
    const removal = new Set<string>()
    const resolvedSource = patch.source.map((snapshot) => {
      const matches = courses.filter((item) => item.occurrenceId === snapshot.occurrenceId)
      if (
        matches.length === 0 &&
        patch.kind === "course" &&
        patch.mode === "move" &&
        snapshot.source.course.scheduleId
      ) {
        const startSection = patch.targetStartSection ?? snapshot.startSection
        const movedUpstream = courses.filter(
          (item) =>
            item.patchIds.length === 0 &&
            item.scheduleId === snapshot.source.course.scheduleId &&
            item.classId === snapshot.source.course.classId &&
            item.syxzdm === snapshot.source.course.syxzdm &&
            item.classType === snapshot.source.course.classType &&
            item.date === patch.targetDate &&
            item.startSection === startSection &&
            item.endSection === startSection + snapshot.endSection - snapshot.startSection
        )
        if (movedUpstream.length === 1) {
          const upstream = movedUpstream[0]!
          issue(patch, "alreadyApplied")
          removal.add(upstream.occurrenceId)
          return {
            ...upstream,
            occurrenceId: snapshot.occurrenceId,
            date: snapshot.date,
            startSection: snapshot.startSection,
            endSection: snapshot.endSection,
            source: snapshot.source,
            patchIds: snapshot.patchIds,
          }
        }
      }
      if (matches.length !== 1) {
        issue(patch, matches.length ? "sourceAmbiguous" : "sourceMissing")
        return snapshot
      }
      const match = matches[0]!
      if (patch.mode !== "copy") removal.add(snapshot.occurrenceId)
      if (occurrenceSignature(match) !== occurrenceSignature(snapshot)) {
        issue(patch, "sourceChanged")
        return snapshot
      }
      return match
    })
    const replacesDay = patch.kind === "day" && patch.mode !== "clear"
    const replaced = replacesDay ? courses.filter((item) => item.date === patch.targetDate) : []
    if (replacesDay) {
      const confirmed = new Map(patch.replaced.map((item) => [item.occurrenceId, item]))
      if (new Set(replaced.map((item) => item.occurrenceId)).size !== replaced.length) {
        issue(patch, "targetChanged")
        continue
      }
      if (
        replaced.some((item) => {
          const expected = confirmed.get(item.occurrenceId)
          return !expected || occurrenceSignature(item) !== occurrenceSignature(expected)
        })
      ) {
        issue(patch, "targetChanged")
        continue
      }
      if (
        patch.replaced.some(
          (item) => !replaced.some((live) => live.occurrenceId === item.occurrenceId)
        )
      ) {
        issue(patch, "targetChanged")
        continue
      }
      if (
        replaced.some((item) => item.patchIds.some((id) => !patch.dependsOn.includes(id))) ||
        patch.replaced.some((item) => {
          const owner = consumed.get(item.occurrenceId)
          return owner !== undefined && !patch.dependsOn.includes(owner)
        })
      ) {
        issue(patch, "patchConflict")
        continue
      }
      for (const item of replaced) removal.add(item.occurrenceId)
    }
    const destination = scheduleWeek(patch.targetDate, termStartDate)
    const inserted =
      patch.mode === "clear"
        ? []
        : resolvedSource.map((item) => {
            const startSection =
              patch.kind === "course"
                ? (patch.targetStartSection ?? item.startSection)
                : item.startSection
            return {
              ...item,
              date: patch.targetDate,
              weekDay: destination.weekday,
              startSection,
              endSection: startSection + item.endSection - item.startSection,
              weeks: String(destination.week),
              weekList: [destination.week],
              classroom:
                patch.classroom !== undefined && patch.kind === "course"
                  ? patch.classroom
                  : item.classroom,
              deliveryMode:
                patch.deliveryMode !== undefined && patch.kind === "course"
                  ? patch.deliveryMode
                  : item.deliveryMode,
              note: patch.note && patch.kind === "course" ? patch.note : item.note,
              occurrenceId: JSON.stringify(["patch", patch.id, item.occurrenceId]),
              patchIds: [...new Set([...item.patchIds, patch.id])],
            }
          })
    if (
      inserted.some(
        (item) =>
          !Number.isInteger(item.startSection) ||
          item.startSection < 1 ||
          !Number.isInteger(item.endSection) ||
          item.endSection < item.startSection
      )
    ) {
      issue(patch, "invalidSections")
      continue
    }
    const remaining = courses.filter((item) => !removal.has(item.occurrenceId))
    if (
      inserted.some((item) =>
        remaining.some(
          (other) =>
            other.date === item.date &&
            other.startSection <= item.endSection &&
            other.endSection >= item.startSection
        )
      )
    ) {
      issue(patch, "targetOverlap")
    }
    if (patch.mode !== "copy") {
      for (const item of resolvedSource) {
        trace(patch, item, patch.mode === "clear" ? "cleared" : "moved")
      }
      for (const item of resolvedSource) consumed.set(item.occurrenceId, patch.id)
    }
    if (replacesDay) {
      for (const item of patch.replaced) trace(patch, item, "replaced")
    }
    for (const id of removal) consumed.set(id, patch.id)
    courses = [...remaining, ...inserted]
    applied.add(patch.id)
  }
  courses.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.startSection - b.startSection ||
      a.occurrenceId.localeCompare(b.occurrenceId)
  )
  return { courses, traces, issues }
}
