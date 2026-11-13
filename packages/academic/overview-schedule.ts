"use client"

import { useEffect, useMemo } from "react"
import {
  useClassPeriods,
  useCurrentWeek,
  useExams,
  useSchedule,
  useTermCalendar,
} from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@orahako/plugin-ui/stores"
import { syncScheduleToWidget, syncExamsToWidget } from "@orahako/plugin-ui/platform"
import { syncClassAlarmsToNative } from "@orahako/plugin-ui/platform"
import { compareExamStartTime, isExamCompleted } from "@orahako/plugin-ui/academic"
import type { ScheduleOccurrence } from "@orahako/plugin-ui/academic"
import type { ClassPeriod, Course, CurrentWeek, Exam } from "@orahako/plugin-sdk/academic"
import type { ProviderQueryResult } from "@orahako/plugin-ui/hooks"
import { useEffectiveSchedule } from "@orahako/plugin-ui/hooks"
import { useAcademicTime } from "@orahako/plugin-ui/hooks"
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  periodIsInUse,
} from "@orahako/academic"
export type OverviewWeekQuery = Omit<ProviderQueryResult<CurrentWeek>, "data" | "mutate"> & {
  data: CurrentWeek | null | undefined
  mutate: () => Promise<unknown>
}

export interface OverviewSchedule {
  currentWeek: OverviewWeekQuery
  schedule: ProviderQueryResult<Course[]>
  exams: ProviderQueryResult<Exam[]>
  periodsRaw: ProviderQueryResult<ClassPeriod[]>
  todayCourses: ScheduleOccurrence[]
  upcomingExams: Exam[]
  timeMap: Record<number, [number, number]>
  now: Date
  date: string
  weekday: number
  semester?: string
  nowMinutes: number
  currentCourse: Course | null
  currentRange: [number, number] | null
  nextCourseInfo: { course: Course; range: [number, number] } | null
  courseTimeRange: (course: Course) => [number, number] | null
}

/** Page-lifetime data and native synchronization, never tied to a visible card. */
export function useOverviewSchedule(): OverviewSchedule {
  const currentWeekQuery = useCurrentWeek()
  const termCalendarQuery = useTermCalendar()
  const scheduleQuery = useSchedule({ courseCategory: "all", includeLabSchedule: true })
  const snapshot = currentWeekQuery.data ?? null
  const termCalendar = termCalendarQuery.data
  const nativeCalendar =
    snapshot?.semester && termCalendar?.semester && snapshot.semester !== termCalendar.semester
      ? undefined
      : termCalendar
  const effective = useEffectiveSchedule(scheduleQuery.data, nativeCalendar, snapshot)
  const {
    now,
    date,
    weekday,
    nowMinutes,
    currentWeek: liveWeek,
  } = useAcademicTime(snapshot, termCalendar)
  const currentWeek: OverviewWeekQuery = {
    ...currentWeekQuery,
    data: liveWeek ?? (snapshot || termCalendar ? null : undefined),
    isLoading: currentWeekQuery.isLoading || termCalendarQuery.isLoading,
    isValidating: currentWeekQuery.isValidating || termCalendarQuery.isValidating,
    isStale: currentWeekQuery.isStale || termCalendarQuery.isStale,
    isError: currentWeekQuery.isError || termCalendarQuery.isError,
    error: currentWeekQuery.error ?? termCalendarQuery.error,
    mutate: () => Promise.all([currentWeekQuery.mutate(), termCalendarQuery.mutate()]),
  }
  const schedule = {
    ...scheduleQuery,
    data: effective.ready
      ? effective.courses
      : currentWeek.data === null
        ? scheduleQuery.data
        : undefined,
  }
  const exams = useExams()
  const periodsRaw = useClassPeriods()
  const reminderHours = useSettingsStore((s) => s.widgetSyncReminderHours)
  const showNextDay = useSettingsStore((s) => s.widgetShowNextDaySchedule)

  const periods = useMemo(
    () => (periodsRaw.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [periodsRaw.data]
  )
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods])

  useEffect(() => {
    if (!effective.ready && liveWeek) return
    void syncScheduleToWidget(
      effective.courses,
      liveWeek,
      periods,
      reminderHours,
      showNextDay,
      nativeCalendar
    ).catch(() => {})
  }, [
    effective.ready,
    effective.courses,
    liveWeek,
    periods,
    reminderHours,
    showNextDay,
    nativeCalendar,
  ])

  useEffect(() => {
    if (!effective.ready && liveWeek) return
    void syncClassAlarmsToNative(effective.courses, liveWeek, periods, nativeCalendar).catch(
      () => {}
    )
  }, [effective.ready, effective.courses, liveWeek, periods, nativeCalendar])

  useEffect(() => {
    // Empty results must also clear stale exams from the native widget.
    if (exams.data) void syncExamsToWidget(exams.data, reminderHours).catch(() => {})
  }, [exams.data, reminderHours])

  const todayCourses = useMemo(() => {
    if (!effective.ready || !liveWeek) return []
    const { week, weekday } = liveWeek
    return effective.courses
      .filter((course) => courseWeekDay(course) === weekday && isCourseActiveInWeek(course, week))
      .sort((a, b) => courseStartSection(a) - courseStartSection(b))
  }, [effective.ready, effective.courses, liveWeek])
  const upcomingExams = useMemo(
    () =>
      (exams.data ?? []).filter((exam) => !isExamCompleted(exam, now)).sort(compareExamStartTime),
    [exams.data, now]
  )
  const currentCourse =
    todayCourses.find((course) => {
      for (
        let section = courseStartSection(course);
        section <= courseEndSection(course);
        section++
      ) {
        const range = timeMap[section]
        if (range && nowMinutes >= range[0] && nowMinutes < range[1]) return true
      }
      return false
    }) ?? null
  const courseTimeRange = (course: Course): [number, number] | null => {
    const start = timeMap[courseStartSection(course)]
    const end = timeMap[courseEndSection(course)]
    return start && end ? [start[0], end[1]] : null
  }
  const currentRange = currentCourse ? courseTimeRange(currentCourse) : null
  let nextCourseInfo: { course: Course; range: [number, number] } | null = null
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
    currentWeek,
    schedule,
    exams,
    periodsRaw,
    todayCourses,
    upcomingExams,
    timeMap,
    now,
    date,
    weekday,
    semester: termCalendar?.semester ?? snapshot?.semester,
    nowMinutes,
    currentCourse,
    currentRange,
    nextCourseInfo,
    courseTimeRange,
  }
}
