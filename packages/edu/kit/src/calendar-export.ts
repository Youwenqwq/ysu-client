import type { ClassPeriod, Course, CurrentWeek, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"

import { getAcademicClock } from "./academic-time"
import {
  DEFAULT_STANDALONE_PERIODS,
  isScheduleEntryActiveOnDate,
  resolveScheduleEntryTime,
} from "./schedule-entries"
import {
  isScheduleOccurrence,
  resolveScheduleTerm,
  scheduleDate,
  scheduleWeek,
} from "./schedule-patches"
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  periodIsInUse,
} from "./schedule-utils"
import { DEFAULT_ACADEMIC_TIME_ZONE, parseAcademicDateTime } from "./time"

export interface CalendarSyncEvent {
  readonly uid: string
  readonly title: string
  readonly location?: string
  readonly description?: string
  readonly startAt: number
  readonly endAt: number
  readonly category: "course" | "event" | "exam"
  readonly remindMinutes?: number
}

export interface BuildCalendarSyncEventsInput {
  readonly courses: readonly Course[]
  readonly extraEntries?: readonly ScheduleEntry[]
  readonly periods?: readonly ClassPeriod[]
  readonly currentWeek: CurrentWeek | null
  readonly calendar?: TermCalendar
  readonly timeZone?: string
  readonly now?: Date
  readonly includeExams?: boolean
  /** Optional prefix prepended to exam titles (e.g. "【考试】" or "[Exam] "). */
  readonly examTitlePrefix?: string
  readonly remindMinutes?: number
  /** Rolling horizon in days for weekly personal items when no academic term is available. */
  readonly standaloneDays?: number
}

export interface SerializeCalendarIcsOptions {
  readonly calendarName?: string
  readonly prodId?: string
  readonly now?: Date
}

function resolveCourseRange(
  course: Course,
  timeMap: Record<number, [number, number]>
): { readonly startMinute: number; readonly endMinute: number } | null {
  const start = timeMap[courseStartSection(course)]
  const end = timeMap[courseEndSection(course)]
  if (!start || !end || end[1] <= start[0]) return null
  return { startMinute: start[0], endMinute: end[1] }
}

function buildCourseDescription(course: Course): string | undefined {
  const parts: string[] = []
  if (course.teacher?.trim()) parts.push(course.teacher.trim())
  if (course.deliveryMode === "online") parts.push("线上")
  if (course.note?.trim()) parts.push(course.note.trim())
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function buildEntryDescription(entry: ScheduleEntry): string | undefined {
  const parts: string[] = []
  if (entry.subtitle?.trim()) parts.push(entry.subtitle.trim())
  if (entry.deliveryMode === "online") parts.push("线上")
  const seat = entry.metadata?.seatNumber
  if (typeof seat === "string" && seat.trim()) parts.push(`座位 ${seat.trim()}`)
  if (entry.note?.trim()) parts.push(entry.note.trim())
  return parts.length > 0 ? parts.join(" · ") : undefined
}

function computeDayStartMs(date: string, timeZone: string): number | null {
  const parsed = parseAcademicDateTime(`${date}T00:00:00`, timeZone)
  return parsed ? parsed.getTime() : null
}

/**
 * Expands courses (academic, overridden, patched, custom), personal schedule entries,
 * and optional exams into concrete timestamped calendar events for Android CalendarContract
 * sync and RFC 5545 `.ics` export.
 */
export function buildCalendarSyncEvents(input: BuildCalendarSyncEventsInput): CalendarSyncEvent[] {
  const timeZone = input.timeZone || DEFAULT_ACADEMIC_TIME_ZONE
  const now = input.now ?? new Date()
  const includeExams = input.includeExams !== false
  const examTitlePrefix = input.examTitlePrefix ?? ""
  const remindMinutes =
    typeof input.remindMinutes === "number" && input.remindMinutes > 0
      ? Math.round(input.remindMinutes)
      : undefined
  const standaloneDays = Math.max(1, Math.round(input.standaloneDays ?? 60))

  const rawPeriods = (input.periods ?? []).filter(periodIsInUse)
  const effectivePeriods =
    rawPeriods.length > 0
      ? [...rawPeriods].sort((a, b) => a.section - b.section)
      : DEFAULT_STANDALONE_PERIODS
  const timeMap = buildSectionTimeMap(effectivePeriods)

  const term = resolveScheduleTerm(input.calendar, input.currentWeek)
  const byUid = new Map<string, CalendarSyncEvent>()

  const pushEvent = (event: CalendarSyncEvent): void => {
    if (!Number.isFinite(event.startAt) || !Number.isFinite(event.endAt)) return
    if (event.endAt <= event.startAt) return
    byUid.set(event.uid, event)
  }

  // 1. Courses (occurrences already carry concrete dates; raw courses expand across the term).
  for (const course of input.courses) {
    const range = resolveCourseRange(course, timeMap)
    if (!range) continue
    const description = buildCourseDescription(course)
    const location = course.classroom?.trim() || undefined

    if (isScheduleOccurrence(course)) {
      const dayStart = computeDayStartMs(course.date, timeZone)
      if (dayStart === null) continue
      pushEvent({
        uid: `course:${course.occurrenceId}`,
        title: course.name,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        startAt: dayStart + range.startMinute * 60_000,
        endAt: dayStart + range.endMinute * 60_000,
        category: "course",
        ...(remindMinutes !== undefined ? { remindMinutes } : {}),
      })
      continue
    }

    if (!term) continue
    const weekday = courseWeekDay(course)
    if (weekday < 1 || weekday > 7) continue
    for (let week = 1; week <= term.totalWeeks; week += 1) {
      if (!isCourseActiveInWeek(course, week)) continue
      const date = scheduleDate(term.termStartDate, week, weekday)
      if (!date) continue
      const dayStart = computeDayStartMs(date, timeZone)
      if (dayStart === null) continue
      const key = course.scheduleId || course.code || course.name
      pushEvent({
        uid: `course:${date}:${courseStartSection(course)}-${courseEndSection(course)}:${key}`,
        title: course.name,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        startAt: dayStart + range.startMinute * 60_000,
        endAt: dayStart + range.endMinute * 60_000,
        category: "course",
        ...(remindMinutes !== undefined ? { remindMinutes } : {}),
      })
    }
  }

  // 2. Extra entries (personal single-date, recurring, and optional exams).
  const extraEntries = input.extraEntries ?? []
  const todayIso = getAcademicClock(now, timeZone).date
  const recurringDates: Array<{
    readonly date: string
    readonly weekday: number
    readonly academicWeek?: number
    readonly dayStart: number
  }> = []

  const hasRecurringEntries = extraEntries.some(
    (entry) => !entry.date && (includeExams || entry.category !== "exam")
  )
  if (hasRecurringEntries) {
    if (term) {
      for (let week = 1; week <= term.totalWeeks; week += 1) {
        for (let weekday = 1; weekday <= 7; weekday += 1) {
          const date = scheduleDate(term.termStartDate, week, weekday)
          if (!date) continue
          const dayStart = computeDayStartMs(date, timeZone)
          if (dayStart === null) continue
          recurringDates.push({ date, weekday, academicWeek: week, dayStart })
        }
      }
    } else {
      for (let offset = 0; offset < standaloneDays; offset += 1) {
        const date = scheduleDate(todayIso, 1, offset + 1)
        if (!date) continue
        const dayStart = computeDayStartMs(date, timeZone)
        if (dayStart === null) continue
        const weekday = getAcademicClock(new Date(dayStart + 43_200_000), timeZone).weekday
        recurringDates.push({ date, weekday, dayStart })
      }
    }
  }

  for (const entry of extraEntries) {
    if (entry.category === "exam" && !includeExams) continue
    const range = resolveScheduleEntryTime(entry, timeMap)
    if (!range) continue
    const description = buildEntryDescription(entry)
    const location = entry.location?.trim() || undefined
    const eventCategory: CalendarSyncEvent["category"] =
      entry.category === "exam"
        ? "exam"
        : entry.category === "course" || entry.category === "custom"
          ? "course"
          : "event"
    const entryRemind =
      remindMinutes !== undefined && (entry.category === "exam" || entry.remindable !== false)
        ? remindMinutes
        : undefined

    const eventTitle =
      entry.category === "exam" && examTitlePrefix && !entry.title.startsWith(examTitlePrefix)
        ? `${examTitlePrefix}${entry.title}`
        : entry.title

    if (entry.date) {
      const dayStart = computeDayStartMs(entry.date, timeZone)
      if (dayStart === null) continue
      pushEvent({
        uid: `entry:${entry.date}:${entry.id}`,
        title: eventTitle,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        startAt: dayStart + range.startMinute * 60_000,
        endAt: dayStart + range.endMinute * 60_000,
        category: eventCategory,
        ...(entryRemind !== undefined ? { remindMinutes: entryRemind } : {}),
      })
      continue
    }

    for (const slot of recurringDates) {
      const academicWeek =
        slot.academicWeek ??
        (term ? scheduleWeek(slot.date, term.termStartDate).week || undefined : undefined)
      if (!isScheduleEntryActiveOnDate(entry, slot.date, slot.weekday, academicWeek)) continue
      pushEvent({
        uid: `entry:${slot.date}:${entry.id}`,
        title: eventTitle,
        ...(location ? { location } : {}),
        ...(description ? { description } : {}),
        startAt: slot.dayStart + range.startMinute * 60_000,
        endAt: slot.dayStart + range.endMinute * 60_000,
        category: eventCategory,
        ...(entryRemind !== undefined ? { remindMinutes: entryRemind } : {}),
      })
    }
  }

  return Array.from(byUid.values()).sort(
    (a, b) => a.startAt - b.startAt || a.endAt - b.endAt || a.title.localeCompare(b.title)
  )
}

function formatIcsUtc(timestamp: number): string {
  const date = new Date(timestamp)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  const h = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  const s = String(date.getUTCSeconds()).padStart(2, "0")
  return `${y}${m}${d}T${h}${min}${s}Z`
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  let rest = line
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75))
    rest = ` ${rest.slice(75)}`
  }
  chunks.push(rest)
  return chunks.join("\r\n")
}

/** Serializes calendar events into an RFC 5545 `.ics` string. */
export function serializeCalendarIcs(
  events: readonly CalendarSyncEvent[],
  options: SerializeCalendarIcsOptions = {}
): string {
  const calendarName = options.calendarName || "酸橙盒日程"
  const prodId = options.prodId || "-//Orahako//Schedule//CN"
  const dtStamp = formatIcsUtc((options.now ?? new Date()).getTime())

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]

  for (const event of events) {
    lines.push("BEGIN:VEVENT")
    lines.push(`UID:${escapeIcsText(event.uid)}@orahako`)
    lines.push(`DTSTAMP:${dtStamp}`)
    lines.push(`DTSTART:${formatIcsUtc(event.startAt)}`)
    lines.push(`DTEND:${formatIcsUtc(event.endAt)}`)
    lines.push(`SUMMARY:${escapeIcsText(event.title)}`)
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`)
    }
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`)
    }
    if (event.remindMinutes && event.remindMinutes > 0) {
      lines.push("BEGIN:VALARM")
      lines.push("ACTION:DISPLAY")
      lines.push(`DESCRIPTION:${escapeIcsText(event.title)}`)
      lines.push(`TRIGGER:-PT${Math.round(event.remindMinutes)}M`)
      lines.push("END:VALARM")
    }
    lines.push("END:VEVENT")
  }

  lines.push("END:VCALENDAR")
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`
}
