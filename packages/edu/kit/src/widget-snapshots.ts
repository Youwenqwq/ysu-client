import type { ClassPeriod, Course, CurrentWeek, Exam, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"

import { getAcademicClock, resolveAcademicWeek } from "./academic-time"
import { formatClockMinute } from "./schedule-entries"
import { parseWeeks } from "./schedule-utils"
import { DEFAULT_ACADEMIC_TIME_ZONE } from "./time"

export interface WidgetScheduleCourse {
  name: string
  classroom?: string
  week_day: number
  week_list: number[]
  start_section: number
  end_section: number
  start_time?: string
  end_time?: string
  date?: string
  category?: "course" | "personal" | "custom"
}

export interface WidgetWeekInfo {
  week: number
  weekday: number
  term?: string
  date?: string
  full_schedule: boolean
  total_weeks?: number
}

export interface ScheduleWidgetSnapshot {
  courses: WidgetScheduleCourse[]
  week: WidgetWeekInfo | null
}

export interface ScheduleWidgetSettings {
  syncReminderHours: number
  showNextDaySchedule: boolean
}

export interface WidgetExam {
  name: string
  exam_name?: string
  start_at?: string
  end_at?: string
  time_text?: string
  exam_location?: string
  seat_number?: string
}

export interface ExamWidgetSnapshot {
  exams: WidgetExam[]
}

export interface ExamWidgetSettings {
  syncReminderHours: number
}

/** Pure snapshot builder mapping provider courses, personal schedule entries, and live academic week into widget JSON. */
export function buildScheduleWidgetSnapshot(
  courses: readonly Course[],
  currentWeek: CurrentWeek | null,
  periods: readonly ClassPeriod[],
  calendar?: TermCalendar,
  now = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE,
  extraEntries: readonly ScheduleEntry[] = []
): ScheduleWidgetSnapshot {
  const periodMap = new Map(periods.map((period) => [period.section, period]))

  const widgetCourses: WidgetScheduleCourse[] = courses.map((course) => {
    const startPeriod = periodMap.get(course.startSection)
    const endPeriod = periodMap.get(course.endSection)
    return {
      name: course.name,
      classroom: course.classroom,
      week_day: course.weekDay,
      week_list: course.weekList ?? parseWeeks(course.weeks || ""),
      start_section: course.startSection,
      end_section: course.endSection,
      start_time: startPeriod?.startTime,
      end_time: endPeriod?.endTime,
    }
  })

  for (const entry of extraEntries) {
    if (entry.category === "exam") continue
    const startSection = entry.sections?.startSection ?? 0
    const endSection = entry.sections?.endSection ?? startSection
    const startTime = entry.time
      ? formatClockMinute(entry.time.startMinute)
      : startSection > 0
        ? periodMap.get(startSection)?.startTime
        : undefined
    const endTime = entry.time
      ? formatClockMinute(entry.time.endMinute)
      : endSection > 0
        ? periodMap.get(endSection)?.endTime
        : undefined
    if (!startTime && startSection <= 0) continue

    widgetCourses.push({
      name: entry.title,
      ...(entry.location ? { classroom: entry.location } : {}),
      week_day: entry.weekDay,
      week_list: entry.weekList ? [...entry.weekList] : [],
      start_section: startSection,
      end_section: endSection,
      ...(startTime ? { start_time: startTime } : {}),
      ...(endTime ? { end_time: endTime } : {}),
      ...(entry.date ? { date: entry.date } : {}),
      category: entry.category,
    })
  }

  const liveWeek = resolveAcademicWeek(
    currentWeek,
    calendar,
    getAcademicClock(now, timeZone).date,
    currentWeek?.semester
  )
  const matchingCalendar =
    calendar &&
    (!calendar.semester || !liveWeek?.semester || calendar.semester === liveWeek.semester)
      ? calendar
      : undefined
  const week: WidgetWeekInfo | null = liveWeek
    ? {
        week: liveWeek.week,
        weekday: liveWeek.weekday,
        term: liveWeek.semester,
        date: liveWeek.date,
        total_weeks: matchingCalendar
          ? (matchingCalendar.totalWeeks > 0
              ? matchingCalendar.totalWeeks
              : matchingCalendar.teachingWeeks) || undefined
          : undefined,
        full_schedule: true,
      }
    : null

  return { courses: widgetCourses, week }
}

/** Pure snapshot builder mapping provider exams into widget JSON. */
export function buildExamWidgetSnapshot(exams: readonly Exam[]): ExamWidgetSnapshot {
  return {
    exams: exams.map((exam) => ({
      name: exam.name,
      exam_name: exam.examName,
      start_at: exam.startAt,
      end_at: exam.endAt,
      time_text: exam.timeText,
      exam_location: exam.examLocation,
      seat_number: exam.seatNumber,
    })),
  }
}
