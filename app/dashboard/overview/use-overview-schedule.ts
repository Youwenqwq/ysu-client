"use client"

import { useEffect, useMemo, useState } from "react"
import {
  useClassPeriods,
  useCurrentWeek,
  useExams,
  useSchedule,
  useTermCalendar,
} from "@/providers/hooks"
import { useSettingsStore } from "@/lib/stores/settings"
import { syncScheduleToWidget, syncExamsToWidget } from "@/lib/native/widget-bridge"
import { syncClassAlarmsToNative } from "@/lib/native/notify"
import { compareExamStartTime, isExamCompleted } from "@/lib/academic/exam-utils"
import type { ClassPeriod, Course, CurrentWeek, Exam } from "@/providers/types"
import type { ProviderQueryResult } from "@/providers/hooks"
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  periodIsInUse,
  resolveWidgetCurrentWeek,
} from "@/app/dashboard/schedule/schedule-utils"

export interface OverviewSchedule {
  currentWeek: ProviderQueryResult<CurrentWeek>
  schedule: ProviderQueryResult<Course[]>
  exams: ProviderQueryResult<Exam[]>
  periodsRaw: ProviderQueryResult<ClassPeriod[]>
  todayCourses: Course[]
  upcomingExams: Exam[]
  timeMap: Record<number, [number, number]>
  now: Date
  nowMinutes: number
  currentCourse: Course | null
  currentRange: [number, number] | null
  nextCourseInfo: { course: Course; range: [number, number] } | null
  courseTimeRange: (course: Course) => [number, number] | null
}

/** Page-lifetime data and native synchronization, never tied to a visible card. */
export function useOverviewSchedule(): OverviewSchedule {
  const currentWeek = useCurrentWeek()
  const termCalendar = useTermCalendar()
  const schedule = useSchedule({ courseCategory: "all", includeLabSchedule: true })
  const exams = useExams()
  const periodsRaw = useClassPeriods()
  const reminderHours = useSettingsStore((s) => s.widgetSyncReminderHours)
  const showNextDay = useSettingsStore((s) => s.widgetShowNextDaySchedule)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const periods = useMemo(
    () => (periodsRaw.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [periodsRaw.data]
  )
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods])
  const widgetCurrentWeek = useMemo(
    () => resolveWidgetCurrentWeek(currentWeek.data ?? null, termCalendar.data?.startDate),
    [currentWeek.data, termCalendar.data?.startDate]
  )
  const activeCourses = useMemo(
    () =>
      widgetCurrentWeek && schedule.data
        ? schedule.data.filter((course) => isCourseActiveInWeek(course, widgetCurrentWeek.week))
        : null,
    [schedule.data, widgetCurrentWeek]
  )

  useEffect(() => {
    if (!activeCourses || !widgetCurrentWeek) return
    void syncScheduleToWidget(
      activeCourses,
      widgetCurrentWeek,
      periods,
      reminderHours,
      showNextDay
    ).catch(() => {})
    void syncClassAlarmsToNative(activeCourses, widgetCurrentWeek, periods).catch(() => {})
  }, [activeCourses, widgetCurrentWeek, periods, reminderHours, showNextDay])

  useEffect(() => {
    // Empty results must also clear stale exams from the native widget.
    if (exams.data) void syncExamsToWidget(exams.data, reminderHours).catch(() => {})
  }, [exams.data, reminderHours])

  const todayCourses = useMemo(() => {
    if (!currentWeek.data) return []
    const { week, weekday } = currentWeek.data
    return (schedule.data ?? [])
      .filter((course) => courseWeekDay(course) === weekday && isCourseActiveInWeek(course, week))
      .sort((a, b) => courseStartSection(a) - courseStartSection(b))
  }, [schedule.data, currentWeek.data])
  const upcomingExams = useMemo(
    () =>
      (exams.data ?? []).filter((exam) => !isExamCompleted(exam, now)).sort(compareExamStartTime),
    [exams.data, now]
  )
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const currentCourse =
    todayCourses.find((course) => {
      for (
        let section = courseStartSection(course);
        section <= courseEndSection(course);
        section++
      ) {
        const range = timeMap[section]
        if (range && nowMinutes >= range[0] && nowMinutes <= range[1]) return true
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
    nowMinutes,
    currentCourse,
    currentRange,
    nextCourseInfo,
    courseTimeRange,
  }
}
