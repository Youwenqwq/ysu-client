import type { ClassPeriod, Course, CurrentWeek, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"

import {
  DEFAULT_STANDALONE_PERIODS,
  formatClockMinute,
  resolveScheduleEntryTime,
} from "./schedule-entries"
import { isScheduleOccurrence, resolveScheduleTerm, scheduleWeek } from "./schedule-patches"
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  parseWeeks,
  periodIsInUse,
} from "./schedule-utils"

export interface SharedSchedulePeriod {
  readonly section: number
  readonly startTime: string
  readonly endTime: string
}

export interface SharedScheduleItem {
  readonly title: string
  readonly location?: string
  readonly subtitle?: string
  readonly category: "course" | "event" | "exam" | "busy"
  readonly date?: string
  readonly weekDay: number
  readonly weekList?: readonly number[]
  readonly startSection?: number
  readonly endSection?: number
  readonly startTime?: string
  readonly endTime?: string
}

export interface SharedSchedulePrivacy {
  readonly enabled: boolean
  readonly showTitle?: boolean
  readonly showLocation?: boolean
  readonly showSubtitle?: boolean
}

export interface SharedSchedulePayload {
  readonly version: 1
  readonly title: string
  readonly masked: boolean
  readonly semester?: string
  readonly termStartDate?: string
  readonly totalWeeks: number
  readonly timeZone?: string
  readonly periods: readonly SharedSchedulePeriod[]
  readonly items: readonly SharedScheduleItem[]
  readonly createdAt: number
}

export interface BuildSharedSchedulePayloadInput {
  readonly courses: readonly Course[]
  readonly extraEntries?: readonly ScheduleEntry[]
  readonly periods?: readonly ClassPeriod[]
  readonly currentWeek: CurrentWeek | null
  readonly calendar?: TermCalendar
  readonly timeZone?: string
  readonly privacy?: SharedSchedulePrivacy
  readonly includePersonal?: boolean
  readonly includeExams?: boolean
  readonly examTitlePrefix?: string
  readonly busyLabel?: string
  readonly now?: Date
}

function sortUniqueNumbers(values: Iterable<number>): number[] {
  return [...new Set(values)].filter((n) => Number.isInteger(n) && n >= 1).sort((a, b) => a - b)
}

/**
 * Builds a compact, privacy-safe schedule snapshot for online sharing.
 * Never includes student credentials, usernames, or private IDs.
 */
export function buildSharedSchedulePayload(
  input: BuildSharedSchedulePayloadInput
): SharedSchedulePayload {
  const masked = input.privacy?.enabled === true
  const showTitle = !masked || input.privacy?.showTitle === true
  const showLocation = !masked || input.privacy?.showLocation === true
  const showSubtitle = !masked || input.privacy?.showSubtitle === true
  const includePersonal = input.includePersonal === true
  const includeExams = input.includeExams === true
  const examTitlePrefix = input.examTitlePrefix ?? ""
  const busyLabel = input.busyLabel || "忙碌"
  const now = input.now ?? new Date()

  const rawPeriods = (input.periods ?? []).filter(periodIsInUse)
  const effectivePeriods =
    rawPeriods.length > 0
      ? [...rawPeriods].sort((a, b) => a.section - b.section)
      : DEFAULT_STANDALONE_PERIODS
  const timeMap = buildSectionTimeMap(effectivePeriods)
  const periodMap = new Map(effectivePeriods.map((period) => [period.section, period]))

  const normalizedPeriods: SharedSchedulePeriod[] = effectivePeriods
    .filter((period) => Boolean(period.startTime && period.endTime))
    .map((period) => ({
      section: period.section,
      startTime: period.startTime!,
      endTime: period.endTime!,
    }))

  const term = resolveScheduleTerm(input.calendar, input.currentWeek)
  const semester = term?.semester || input.currentWeek?.semester || input.calendar?.semester
  const totalWeeks = term?.totalWeeks ?? Math.max(input.calendar?.totalWeeks ?? 0, 20)

  // Compact courses (including expanded ScheduleOccurrence[]) by slot & metadata to keep JSON tiny.
  const courseBuckets = new Map<
    string,
    {
      title: string
      location?: string
      subtitle?: string
      weekDay: number
      startSection: number
      endSection: number
      startTime?: string
      endTime?: string
      weeks: Set<number>
    }
  >()

  for (const course of input.courses) {
    const startSection = courseStartSection(course)
    const endSection = courseEndSection(course)
    const weekDay = courseWeekDay(course)
    if (weekDay < 1 || weekDay > 7) continue
    const startTime = periodMap.get(startSection)?.startTime
    const endTime = periodMap.get(endSection)?.endTime
    const title = showTitle ? course.name : busyLabel
    const location = showLocation ? course.classroom?.trim() || undefined : undefined
    const subtitle = showSubtitle ? course.teacher?.trim() || undefined : undefined

    const weeks: number[] = []
    if (isScheduleOccurrence(course) && term?.termStartDate) {
      const w = scheduleWeek(course.date, term.termStartDate).week
      if (w >= 1) weeks.push(w)
    } else {
      const list = course.weekList?.length ? course.weekList : parseWeeks(course.weeks || "")
      weeks.push(...list)
    }
    if (weeks.length === 0) continue

    const bucketKey = JSON.stringify([
      title,
      location ?? "",
      subtitle ?? "",
      weekDay,
      startSection,
      endSection,
    ])
    const existing = courseBuckets.get(bucketKey)
    if (existing) {
      for (const w of weeks) existing.weeks.add(w)
    } else {
      courseBuckets.set(bucketKey, {
        title,
        location,
        subtitle,
        weekDay,
        startSection,
        endSection,
        startTime,
        endTime,
        weeks: new Set(weeks),
      })
    }
  }

  const items: SharedScheduleItem[] = []
  for (const bucket of courseBuckets.values()) {
    items.push({
      title: bucket.title,
      ...(bucket.location ? { location: bucket.location } : {}),
      ...(bucket.subtitle ? { subtitle: bucket.subtitle } : {}),
      category: showTitle ? "course" : "busy",
      weekDay: bucket.weekDay,
      weekList: sortUniqueNumbers(bucket.weeks),
      startSection: bucket.startSection,
      endSection: bucket.endSection,
      ...(bucket.startTime ? { startTime: bucket.startTime } : {}),
      ...(bucket.endTime ? { endTime: bucket.endTime } : {}),
    })
  }

  // Optional extra entries (personal events & exams).
  for (const entry of input.extraEntries ?? []) {
    if (entry.category === "exam" && !includeExams) continue
    if (entry.category !== "exam" && !includePersonal) continue
    const resolvedTime = resolveScheduleEntryTime(entry, timeMap)
    if (!resolvedTime && !entry.sections) continue

    const rawTitle =
      entry.category === "exam" && examTitlePrefix && !entry.title.startsWith(examTitlePrefix)
        ? `${examTitlePrefix}${entry.title}`
        : entry.title
    const title = showTitle ? rawTitle : busyLabel
    const location = showLocation ? entry.location?.trim() || undefined : undefined
    const subtitle = showSubtitle ? entry.subtitle?.trim() || undefined : undefined

    items.push({
      title,
      ...(location ? { location } : {}),
      ...(subtitle ? { subtitle } : {}),
      category: !showTitle
        ? "busy"
        : entry.category === "exam"
          ? "exam"
          : entry.category === "course" || entry.category === "custom"
            ? "course"
            : "event",
      ...(entry.date ? { date: entry.date } : {}),
      weekDay: entry.weekDay,
      ...(entry.weekList && entry.weekList.length > 0
        ? { weekList: sortUniqueNumbers(entry.weekList) }
        : {}),
      ...(entry.sections
        ? {
            startSection: entry.sections.startSection,
            endSection: entry.sections.endSection,
          }
        : {}),
      ...(resolvedTime
        ? {
            startTime: formatClockMinute(resolvedTime.startMinute),
            endTime: formatClockMinute(resolvedTime.endMinute),
          }
        : {}),
    })
  }

  return {
    version: 1,
    title: semester ? `${semester} 日程` : "日程",
    masked,
    ...(semester ? { semester } : {}),
    ...(term?.termStartDate ? { termStartDate: term.termStartDate } : {}),
    totalWeeks,
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    periods: normalizedPeriods,
    items,
    createdAt: now.getTime(),
  }
}
