import type { CurrentWeek, TermCalendar } from "@/providers/types"
import { scheduleDate, scheduleWeek } from "./schedule-patches"

export const SCHOOL_TIME_ZONE = "Asia/Shanghai"

const clockFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** School wall time, independent of the device's display timezone. */
export function getAcademicClock(now = new Date()) {
  let year = "",
    month = "",
    day = "",
    hour = 0,
    minute = 0
  for (const part of clockFormatter.formatToParts(now)) {
    switch (part.type) {
      case "year":
        year = part.value
        break
      case "month":
        month = part.value
        break
      case "day":
        day = part.value
        break
      case "hour":
        hour = Number(part.value)
        break
      case "minute":
        minute = Number(part.value)
        break
    }
  }
  const date = `${year}-${month}-${day}`
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  return { date, weekday, minutes: hour * 60 + minute }
}

/** Rebuild a live week from dated teaching information; never advance a bare cached week number. */
export function resolveAcademicWeek(
  snapshot: CurrentWeek | null,
  calendar: TermCalendar | undefined,
  date: string,
  requestedSemester?: string
): CurrentWeek | null {
  const semester =
    requestedSemester?.trim() || calendar?.semester?.trim() || snapshot?.semester?.trim()
  const matchingCalendar =
    calendar && (!calendar.semester || calendar.semester === semester) ? calendar : undefined
  const matchingSnapshot =
    snapshot && (!snapshot.semester || snapshot.semester === semester) ? snapshot : null
  if (
    !requestedSemester?.trim() &&
    calendar?.semester &&
    snapshot?.semester &&
    calendar.semester !== snapshot.semester
  )
    return null
  const today = scheduleDate(date, 1, 1)
  if (!today) return null

  let start = matchingCalendar?.startDate ? scheduleDate(matchingCalendar.startDate, 1, 1) : ""
  if (
    !start &&
    matchingSnapshot &&
    Number.isInteger(matchingSnapshot.week) &&
    matchingSnapshot.week >= 1
  ) {
    const anchor = matchingSnapshot.weekStartDate || matchingSnapshot.weekDates?.[0]
    if (anchor) {
      start = scheduleDate(anchor, 2 - matchingSnapshot.week, 1)
    } else if (
      matchingSnapshot.date &&
      Number.isInteger(matchingSnapshot.weekday) &&
      matchingSnapshot.weekday >= 1 &&
      matchingSnapshot.weekday <= 7
    ) {
      start = scheduleDate(
        matchingSnapshot.date,
        2 - matchingSnapshot.week,
        2 - matchingSnapshot.weekday
      )
    }
  }
  if (!start || new Date(`${start}T12:00:00Z`).getUTCDay() !== 1) return null

  const { week, weekday } = scheduleWeek(today, start)
  const totalWeeks =
    (matchingCalendar?.totalWeeks || 0) > 0
      ? matchingCalendar!.totalWeeks
      : matchingCalendar?.teachingWeeks || 0
  if (week < 1 || (totalWeeks > 0 && week > totalWeeks)) return null
  const weekDates = Array.from({ length: 7 }, (_, day) => scheduleDate(start, week, day + 1))
  return {
    week,
    weekday,
    semester,
    date: today,
    weekStartDate: weekDates[0],
    weekEndDate: weekDates[6],
    weekDates,
  }
}
