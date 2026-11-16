/**
 * Declarative widget snapshots for schedule and exam feature surfaces.
 *
 * The native generic widget capability stores these snapshots verbatim; only
 * the schedule/exam companion renderers interpret them. Keeping the DTOs here
 * (rather than in the runtime/native widget wrapper) prevents the generic
 * bridge from depending on academic domain types.
 */
import type {
  ClassPeriod,
  Course,
  CurrentWeek,
  Exam,
  TermCalendar,
} from "@orahako/plugin-sdk/academic"
import type { PluginNativeService } from "@orahako/plugin-sdk"
import {
  WIDGETS_EXAM_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  invokeWidgetCapability,
} from "@/plugins/official/runtime/native/widget-bridge"
import { getAcademicClock, resolveAcademicWeek } from "./academic-time"
import { parseWeeks } from "./schedule-utils"

export interface WidgetScheduleCourse {
  name: string
  classroom?: string
  week_day: number
  week_list: number[]
  start_section: number
  end_section: number
  start_time?: string
  end_time?: string
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

/** Maps provider courses and the live academic week into the widget snapshot. */
export function buildScheduleWidgetSnapshot(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  calendar?: TermCalendar
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

  const liveWeek = resolveAcademicWeek(
    currentWeek,
    calendar,
    getAcademicClock().date,
    currentWeek?.semester
  )
  const matchingCalendar =
    calendar && (!calendar.semester || !liveWeek?.semester || calendar.semester === liveWeek.semester)
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

export function buildExamWidgetSnapshot(exams: Exam[]): ExamWidgetSnapshot {
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

export async function syncScheduleWidgets(
  native: PluginNativeService,
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  syncReminderHours = 24,
  showNextDaySchedule = false,
  calendar?: TermCalendar
): Promise<void> {
  const snapshot = buildScheduleWidgetSnapshot(courses, currentWeek, periods, calendar)
  const settings: ScheduleWidgetSettings = { syncReminderHours, showNextDaySchedule }
  await invokeWidgetCapability(native, WIDGETS_SCHEDULE_CAPABILITY, "sync", {
    snapshot,
    settings,
  })
}

export async function syncScheduleWidgetSettings(
  native: PluginNativeService,
  syncReminderHours: number,
  showNextDaySchedule = false
): Promise<void> {
  const settings: ScheduleWidgetSettings = { syncReminderHours, showNextDaySchedule }
  await invokeWidgetCapability(native, WIDGETS_SCHEDULE_CAPABILITY, "settings", { settings })
}

export async function syncExamWidgets(
  native: PluginNativeService,
  exams: Exam[],
  syncReminderHours = 24
): Promise<void> {
  const snapshot = buildExamWidgetSnapshot(exams)
  const settings: ExamWidgetSettings = { syncReminderHours }
  await invokeWidgetCapability(native, WIDGETS_EXAM_CAPABILITY, "sync", {
    snapshot,
    settings,
  })
}
