import {
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  parseTimeToMinutes,
  periodEndTime,
  periodStartTime,
} from "@orahako/academic-kit"
import type { ClassPeriod, ClassroomInfo, Course } from "@orahako/academic-sdk"

export type TimePreset = "now" | "next" | "afternoon" | "evening" | "tomorrow" | "custom"

export interface FreeRoomQuerySlot {
  readonly week: number
  readonly day: number
  readonly startSection: number
  readonly endSection: number
}

export type RoomAvailabilityStatus = "free" | "occupied" | "loading" | "error"

export interface RoomAvailability {
  readonly room: ClassroomInfo
  readonly status: RoomAvailabilityStatus
  readonly courses: readonly Course[]
  readonly freeAllDay: boolean
  readonly freeUntilSection: number | null
  readonly freeUntilTime?: string
  readonly freeSectionsCount: number
  readonly currentCourse?: Course
  readonly nextCourse?: Course
  readonly nextCourseStartTime?: string
  readonly nextFreeSection: number | null
  readonly nextFreeTime?: string
}

function clampSection(section: number, minSection: number, maxSection: number): number {
  return Math.max(minSection, Math.min(maxSection, section))
}

function rollTomorrow(
  week: number,
  weekday: number,
  totalWeeks: number
): { readonly week: number; readonly day: number } {
  if (weekday >= 7) {
    return {
      week: Math.min(Math.max(1, totalWeeks || week + 1), week + 1),
      day: 1,
    }
  }
  return { week, day: weekday + 1 }
}

/**
 * Resolve a quick time preset into a concrete `(week, day, startSection..endSection)` slot.
 */
export function resolveTimePreset(
  preset: Exclude<TimePreset, "custom">,
  options: {
    readonly currentWeek: number
    readonly totalWeeks: number
    readonly weekday: number
    readonly nowMinutes: number
    readonly periods: readonly ClassPeriod[]
  }
): FreeRoomQuerySlot {
  const sorted = [...options.periods].sort((a, b) => a.section - b.section)
  const minSection = sorted[0]?.section ?? 1
  const maxSection = sorted.at(-1)?.section ?? 12
  const safeWeek = Math.max(1, options.currentWeek || 1)
  const safeDay = options.weekday >= 1 && options.weekday <= 7 ? options.weekday : 1

  const findSectionRangeByMinutes = (
    minMinute: number,
    maxMinute: number,
    fallbackStart: number,
    fallbackEnd: number
  ): { readonly start: number; readonly end: number } => {
    const matched = sorted.filter((p) => {
      const start = parseTimeToMinutes(p.startTime)
      return start !== null && start >= minMinute && start < maxMinute
    })
    if (matched.length > 0) {
      return {
        start: matched[0]!.section,
        end: matched[matched.length - 1]!.section,
      }
    }
    const start = clampSection(fallbackStart, minSection, maxSection)
    const end = clampSection(fallbackEnd, start, maxSection)
    return { start, end }
  }

  // Pair section into natural 2-section class blocks (1-2, 3-4, 5-6, ...)
  const pairEnd = (start: number): number => {
    const paired = start % 2 === 1 ? start + 1 : start
    return clampSection(paired, start, maxSection)
  }

  const findCurrentOrNextBlock = (): {
    readonly week: number
    readonly day: number
    readonly start: number
    readonly end: number
  } => {
    for (const p of sorted) {
      const start = parseTimeToMinutes(p.startTime)
      const end = parseTimeToMinutes(p.endTime)
      if (
        start !== null &&
        end !== null &&
        options.nowMinutes >= start &&
        options.nowMinutes < end
      ) {
        return { week: safeWeek, day: safeDay, start: p.section, end: pairEnd(p.section) }
      }
    }
    const upcoming = sorted.find((p) => {
      const start = parseTimeToMinutes(p.startTime)
      return start !== null && start > options.nowMinutes
    })
    if (upcoming) {
      return {
        week: safeWeek,
        day: safeDay,
        start: upcoming.section,
        end: pairEnd(upcoming.section),
      }
    }
    // After the last class of the day -> roll to tomorrow morning
    const tomorrow = rollTomorrow(safeWeek, safeDay, options.totalWeeks)
    return {
      week: tomorrow.week,
      day: tomorrow.day,
      start: minSection,
      end: pairEnd(minSection),
    }
  }

  if (preset === "now") {
    const slot = findCurrentOrNextBlock()
    return { week: slot.week, day: slot.day, startSection: slot.start, endSection: slot.end }
  }

  if (preset === "next") {
    const nowSlot = findCurrentOrNextBlock()
    const nextStart = nowSlot.end + 1
    if (nextStart <= maxSection) {
      return {
        week: nowSlot.week,
        day: nowSlot.day,
        startSection: nextStart,
        endSection: pairEnd(nextStart),
      }
    }
    const nextDay = rollTomorrow(nowSlot.week, nowSlot.day, options.totalWeeks)
    return {
      week: nextDay.week,
      day: nextDay.day,
      startSection: minSection,
      endSection: pairEnd(minSection),
    }
  }

  if (preset === "afternoon") {
    const range = findSectionRangeByMinutes(13 * 60, 18 * 60, 5, 8)
    const afternoonEndMin =
      parseTimeToMinutes(sorted.find((p) => p.section === range.end)?.endTime ?? "") ?? 18 * 60
    const target =
      options.nowMinutes >= afternoonEndMin
        ? rollTomorrow(safeWeek, safeDay, options.totalWeeks)
        : { week: safeWeek, day: safeDay }
    return {
      week: target.week,
      day: target.day,
      startSection: range.start,
      endSection: range.end,
    }
  }

  if (preset === "evening") {
    const range = findSectionRangeByMinutes(18 * 60, 24 * 60, 9, Math.min(maxSection, 11))
    const eveningEndMin =
      parseTimeToMinutes(sorted.find((p) => p.section === range.end)?.endTime ?? "") ?? 22 * 60
    const target =
      options.nowMinutes >= eveningEndMin
        ? rollTomorrow(safeWeek, safeDay, options.totalWeeks)
        : { week: safeWeek, day: safeDay }
    return {
      week: target.week,
      day: target.day,
      startSection: range.start,
      endSection: range.end,
    }
  }

  // tomorrow morning (sections 1-4 or 1-2)
  const tomorrow = rollTomorrow(safeWeek, safeDay, options.totalWeeks)
  return {
    week: tomorrow.week,
    day: tomorrow.day,
    startSection: minSection,
    endSection: pairEnd(minSection),
  }
}

/**
 * Compute real-time availability of a single classroom for the requested `(week, day, startSection..endSection)`.
 */
export function computeRoomAvailability(
  room: ClassroomInfo,
  courses: readonly Course[] | undefined,
  periods: readonly ClassPeriod[],
  slot: FreeRoomQuerySlot,
  options?: { readonly failed?: boolean }
): RoomAvailability {
  if (courses === undefined) {
    return {
      room,
      status: options?.failed ? "error" : "loading",
      courses: [],
      freeAllDay: false,
      freeUntilSection: null,
      freeSectionsCount: 0,
      nextFreeSection: null,
    }
  }

  const sortedPeriods = [...periods].sort((a, b) => a.section - b.section)
  const periodMap = new Map(sortedPeriods.map((p) => [p.section, p]))
  const minSection = sortedPeriods[0]?.section ?? 1
  const maxSection = sortedPeriods.at(-1)?.section ?? 12
  const startSection = clampSection(slot.startSection, minSection, maxSection)
  const endSection = clampSection(slot.endSection, startSection, maxSection)

  const dayCourses = courses
    .filter(
      (course) => courseWeekDay(course) === slot.day && isCourseActiveInWeek(course, slot.week)
    )
    .sort((a, b) => courseStartSection(a) - courseStartSection(b))

  const occupiedBySection = new Map<number, Course>()
  for (const course of dayCourses) {
    const cStart = courseStartSection(course)
    const cEnd = courseEndSection(course)
    for (let s = cStart; s <= cEnd; s++) {
      if (!occupiedBySection.has(s)) {
        occupiedBySection.set(s, course)
      }
    }
  }

  let blockingCourse: Course | undefined
  for (let s = startSection; s <= endSection; s++) {
    const found = occupiedBySection.get(s)
    if (found) {
      blockingCourse = found
      break
    }
  }

  if (blockingCourse) {
    let nextFreeSection: number | null = null
    for (let s = endSection + 1; s <= maxSection; s++) {
      if (!occupiedBySection.has(s)) {
        nextFreeSection = s
        break
      }
    }
    const nextFreePeriod = nextFreeSection !== null ? periodMap.get(nextFreeSection) : undefined
    return {
      room,
      status: "occupied",
      courses,
      freeAllDay: false,
      freeUntilSection: null,
      freeSectionsCount: 0,
      currentCourse: blockingCourse,
      nextFreeSection,
      ...(nextFreePeriod && periodStartTime(nextFreePeriod)
        ? { nextFreeTime: periodStartTime(nextFreePeriod) }
        : {}),
    }
  }

  // Room is free for the entire requested [startSection..endSection] range!
  let freeUntilSection = endSection
  let nextCourse: Course | undefined
  for (let s = endSection + 1; s <= maxSection; s++) {
    const occ = occupiedBySection.get(s)
    if (occ) {
      nextCourse = occ
      break
    }
    freeUntilSection = s
  }

  const freeAllDay = dayCourses.length === 0
  const freeSectionsCount = freeUntilSection - startSection + 1
  const untilPeriod = periodMap.get(freeUntilSection)
  const nextStartPeriod = nextCourse ? periodMap.get(courseStartSection(nextCourse)) : undefined

  return {
    room,
    status: "free",
    courses,
    freeAllDay,
    freeUntilSection,
    ...(untilPeriod && periodEndTime(untilPeriod)
      ? { freeUntilTime: periodEndTime(untilPeriod) }
      : {}),
    freeSectionsCount,
    ...(nextCourse ? { nextCourse } : {}),
    ...(nextStartPeriod && periodStartTime(nextStartPeriod)
      ? { nextCourseStartTime: periodStartTime(nextStartPeriod) }
      : {}),
    nextFreeSection: null,
  }
}

export function sortRoomAvailabilities(
  items: readonly RoomAvailability[],
  favoriteCodes: ReadonlySet<string>
): RoomAvailability[] {
  const rankStatus = (status: RoomAvailabilityStatus): number => {
    switch (status) {
      case "free":
        return 0
      case "loading":
        return 1
      case "occupied":
        return 2
      case "error":
        return 3
    }
  }

  return [...items].sort((a, b) => {
    const statusDiff = rankStatus(a.status) - rankStatus(b.status)
    if (statusDiff !== 0) return statusDiff

    const favDiff = Number(favoriteCodes.has(b.room.code)) - Number(favoriteCodes.has(a.room.code))
    if (favDiff !== 0) return favDiff

    if (a.status === "free" && b.status === "free") {
      if (a.freeAllDay !== b.freeAllDay) return a.freeAllDay ? -1 : 1
      if (b.freeSectionsCount !== a.freeSectionsCount) {
        return b.freeSectionsCount - a.freeSectionsCount
      }
    }

    const floorA = a.room.floor ?? 999
    const floorB = b.room.floor ?? 999
    if (floorA !== floorB) return floorA - floorB

    return a.room.name.localeCompare(b.room.name, "zh-Hans-CN", { numeric: true })
  })
}
