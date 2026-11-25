import type { ClassPeriod, Course, CurrentWeek, Exam, TermCalendar } from "@orahako/academic-sdk"

import { getAcademicClock, resolveAcademicWeek } from "./academic-time"
import { compareExamStartTime, isExamCompleted } from "./exam-utils"
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  isCourseCurrent,
  periodIsInUse,
} from "./schedule-utils"

export interface OverviewScheduleInput<TCourse extends Course = Course> {
  courses: readonly TCourse[]
  exams?: readonly Exam[]
  periods?: readonly ClassPeriod[]
  currentWeek: CurrentWeek | null
  calendar?: TermCalendar
  now?: Date
  /** IANA school timezone for the live clock and offset-less exam timestamps. */
  timeZone?: string
}

export interface OverviewScheduleSnapshot<TCourse extends Course = Course> {
  liveWeek: CurrentWeek | null
  todayCourses: TCourse[]
  upcomingExams: Exam[]
  periods: ClassPeriod[]
  timeMap: Record<number, [number, number]>
  now: Date
  date: string
  weekday: number
  semester?: string
  nowMinutes: number
  currentCourse: TCourse | null
  currentRange: [number, number] | null
  nextCourseInfo: { course: TCourse; range: [number, number] } | null
  courseTimeRange: (course: Course) => [number, number] | null
}

export function formatMinutesClock(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}

export function computeTodayCourses<TCourse extends Course>(
  courses: readonly TCourse[],
  liveWeek: Pick<CurrentWeek, "week" | "weekday"> | null
): TCourse[] {
  if (!liveWeek) return []
  const { week, weekday } = liveWeek
  return courses
    .filter((course) => courseWeekDay(course) === weekday && isCourseActiveInWeek(course, week))
    .sort((a, b) => courseStartSection(a) - courseStartSection(b))
}

export function computeCourseTimeRange(
  course: Course,
  timeMap: Record<number, [number, number]>
): [number, number] | null {
  const start = timeMap[courseStartSection(course)]
  const end = timeMap[courseEndSection(course)]
  return start && end ? [start[0], end[1]] : null
}

/**
 * Pure, side-effect-free computation of today's schedule, ongoing/next course,
 * and upcoming exams for academic overview widgets.
 */
export function computeOverviewSchedule<TCourse extends Course = Course>({
  courses,
  exams = [],
  periods: rawPeriods = [],
  currentWeek,
  calendar,
  now = new Date(),
  timeZone,
}: OverviewScheduleInput<TCourse>): OverviewScheduleSnapshot<TCourse> {
  const { date, weekday, minutes: nowMinutes } = getAcademicClock(now, timeZone)
  const liveWeek = resolveAcademicWeek(currentWeek, calendar, date, currentWeek?.semester)
  const periods = rawPeriods.filter(periodIsInUse).sort((a, b) => a.section - b.section)
  const timeMap = buildSectionTimeMap(periods)
  const todayCourses = computeTodayCourses(courses, liveWeek)
  const upcomingExams = exams
    .filter((exam) => !isExamCompleted(exam, now, timeZone))
    .sort((a, b) => compareExamStartTime(a, b, timeZone))

  const courseTimeRange = (course: Course) => computeCourseTimeRange(course, timeMap)
  const currentCourse =
    todayCourses.find((course) => isCourseCurrent(course, nowMinutes, timeMap)) ?? null
  const currentRange = currentCourse ? courseTimeRange(currentCourse) : null

  let nextCourseInfo: { course: TCourse; range: [number, number] } | null = null
  if (!currentCourse) {
    for (const course of todayCourses) {
      const range = courseTimeRange(course)
      if (range && range[0] > nowMinutes) {
        nextCourseInfo = { course, range }
        break
      }
    }
  }

  return {
    liveWeek,
    todayCourses,
    upcomingExams,
    periods,
    timeMap,
    now,
    date,
    weekday,
    semester: calendar?.semester ?? currentWeek?.semester ?? liveWeek?.semester,
    nowMinutes,
    currentCourse,
    currentRange,
    nextCourseInfo,
    courseTimeRange,
  }
}
