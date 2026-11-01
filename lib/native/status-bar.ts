import { isCourseActiveInWeek, courseEndSection, courseStartSection, courseWeekDay } from "@/app/dashboard/schedule/schedule-utils"
import { getAcademicClock, resolveAcademicWeek } from "@/lib/academic/academic-time"
import { scheduleDate } from "@/lib/academic/schedule-patches"
import { parseAcademicDateTime } from "@/lib/academic/time"
import type { ClassPeriod, Course, CurrentWeek, TermCalendar } from "@/providers/types"
import { isMacOSNative, macInvoke } from "./macos"

export interface StatusBarClass {
  name: string
  classroom: string
  startsAt: number
  endsAt: number
}

const FORECAST_DAYS = 7
let lastClassesHash = ""

function minutesFromTime(value: string | undefined): number | null {
  if (!value) return null
  const [hours, minutes] = value.split(":").map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

/** Expand the next teaching week into concrete class ranges for the status bar. */
export function computeStatusBarClasses(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  calendar?: TermCalendar,
  now: number = Date.now()
): StatusBarClass[] {
  const periodMap = new Map(periods.map((period) => [period.section, period]))
  const today = getAcademicClock(new Date(now)).date
  const classes: StatusBarClass[] = []

  for (let offset = 0; offset < FORECAST_DAYS; offset++) {
    const date = scheduleDate(today, 1, offset + 1)
    const targetWeek = resolveAcademicWeek(currentWeek, calendar, date, currentWeek?.semester)
    if (!targetWeek) continue
    const dayStart = parseAcademicDateTime(`${date}T00:00:00`)?.getTime()
    if (dayStart === undefined) continue

    for (const course of courses) {
      if (courseWeekDay(course) !== targetWeek.weekday) continue
      if (!isCourseActiveInWeek(course, targetWeek.week)) continue
      const start = minutesFromTime(periodMap.get(courseStartSection(course))?.startTime)
      const end = minutesFromTime(periodMap.get(courseEndSection(course))?.endTime)
      if (start === null || end === null || end <= start) continue
      const startsAt = dayStart + start * 60_000
      const endsAt = dayStart + end * 60_000
      if (endsAt <= now) continue
      classes.push({
        name: course.name,
        classroom: course.classroom || "",
        startsAt,
        endsAt,
      })
    }
  }

  return classes.sort((a, b) => a.startsAt - b.startsAt)
}

/** Push the upcoming classes once per change; the native item refreshes itself by time. */
export async function syncStatusBarClasses(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  calendar?: TermCalendar
): Promise<void> {
  if (!isMacOSNative()) return
  const classes = computeStatusBarClasses(courses, currentWeek, periods, calendar)
  const hash = JSON.stringify(classes)
  if (hash === lastClassesHash) return
  lastClassesHash = hash
  await macInvoke("status.setClasses", { classes })
}

export async function clearStatusBarClasses(): Promise<void> {
  lastClassesHash = ""
  if (!isMacOSNative()) return
  await macInvoke("status.clear", {})
}
