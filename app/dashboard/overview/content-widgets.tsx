"use client"

import Link from "next/link"
import { BookOpen, Calendar, ChevronRight, ClipboardCheck, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import { formatExamTime, getExamStartTime } from "@/lib/academic/exam-utils"
import {
  courseEndSection,
  courseStartSection,
  isCoursePast,
} from "@/app/dashboard/schedule/schedule-utils"
import type { ProviderQueryResult } from "@/providers/hooks"
import type { EvaluationTask } from "@/providers/types"
import type { OverviewSchedule } from "./use-overview-schedule"
import { QueryState } from "./query-state"

function clockText(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`
}

export function CourseProgressWidget({ data }: { data: OverviewSchedule }) {
  const { t } = useTranslation()
  const { currentCourse, currentRange, nextCourseInfo, nowMinutes } = data
  const course = currentCourse ?? nextCourseInfo?.course
  const range = currentRange ?? nextCourseInfo?.range
  const countdownText = (minutes: number) => {
    if (minutes < 60) return t("dashboard.minutesOnly", { minutes: Math.max(1, minutes) })
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0
      ? t("dashboard.hoursMinutes", { hours, minutes: rest })
      : t("dashboard.hoursOnly", { hours })
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          {t(currentCourse ? "dashboard.ongoingNow" : "dashboard.nextCourse")}
        </CardTitle>
        {range && (
          <Badge variant={currentCourse ? "default" : "secondary"}>
            {t(currentCourse ? "dashboard.remaining" : "dashboard.startsIn", {
              time: countdownText(currentCourse ? range[1] - nowMinutes : range[0] - nowMinutes),
            })}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <QueryState queries={[data.schedule, data.currentWeek, data.periodsRaw]}>
          {course && range && (
            <div className="flex flex-col gap-2">
              <Link
                href="/dashboard/schedule"
                className="rounded-sm text-lg font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {course.name}
              </Link>
              <p className="text-sm text-muted-foreground">
                {[course.teacher, course.classroom].filter(Boolean).join(" · ")}
              </p>
              {currentCourse && (
                <Progress
                  aria-label={t("dashboard.ongoingNow")}
                  value={Math.min(
                    100,
                    Math.max(0, ((nowMinutes - range[0]) / Math.max(1, range[1] - range[0])) * 100)
                  )}
                  className="h-1.5"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {clockText(range[0])} - {clockText(range[1])}
              </p>
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  )
}

export function TodayCoursesWidget({ data }: { data: OverviewSchedule }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          {t("dashboard.todayCourses")}
        </CardTitle>
        <Link
          href="/dashboard/schedule"
          aria-label={t("app.schedule")}
          className="rounded-sm p-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight className="size-4" />
        </Link>
      </CardHeader>
      <CardContent>
        <QueryState queries={[data.schedule, data.currentWeek]}>
          {data.todayCourses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noCoursesToday")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.todayCourses.map((course, index) => {
                const isCurrent = course === data.currentCourse
                const isPast = !isCurrent && isCoursePast(course, data.nowMinutes, data.timeMap)
                const range = data.courseTimeRange(course)
                return (
                  <div
                    key={`${course.scheduleId ?? course.name}-${course.startSection}-${index}`}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3",
                      isCurrent && "border-primary bg-primary/5",
                      isPast && "opacity-50"
                    )}
                  >
                    {range && (
                      <div className="flex w-11 shrink-0 flex-col text-xs leading-tight text-muted-foreground">
                        <span>{clockText(range[0])}</span>
                        <span>{clockText(range[1])}</span>
                      </div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{course.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[course.teacher, course.classroom].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <Badge variant={isCurrent ? "default" : "outline"} className="shrink-0">
                      {isCurrent
                        ? t("dashboard.ongoingNow")
                        : t("dashboard.sectionRange", {
                            start: courseStartSection(course),
                            end: courseEndSection(course),
                          })}
                    </Badge>
                  </div>
                )
              })}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  )
}

export function UpcomingExamsWidget({ data }: { data: OverviewSchedule }) {
  const { t } = useTranslation()
  const today = new Date(data.now.getFullYear(), data.now.getMonth(), data.now.getDate()).getTime()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-4 text-primary" />
          {t("dashboard.upcomingExams")}
        </CardTitle>
        <Link
          href="/dashboard/exams"
          className="rounded-sm p-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant="secondary">
            {t("dashboard.examCount", { count: data.upcomingExams.length })}
          </Badge>
        </Link>
      </CardHeader>
      <CardContent>
        <QueryState queries={[data.exams]}>
          {data.upcomingExams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noExams")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.upcomingExams.map((exam, index) => {
                const date = getExamStartTime(exam)
                const dayDiff = date
                  ? Math.round(
                      (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
                        today) /
                        86_400_000
                    )
                  : null
                return (
                  <div
                    key={`${exam.name}-${exam.startAt}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm font-medium">{exam.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          formatExamTime(exam),
                          exam.examLocation,
                          exam.seatNumber
                            ? t("dashboard.seatNumber", { num: exam.seatNumber })
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    {dayDiff !== null && dayDiff >= 0 && (
                      <Badge variant={dayDiff <= 1 ? "default" : "secondary"} className="shrink-0">
                        {dayDiff === 0
                          ? t("dashboard.examToday")
                          : dayDiff === 1
                            ? t("dashboard.examTomorrow")
                            : t("dashboard.examInDays", { count: dayDiff })}
                      </Badge>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  )
}

export function EvaluationTasksWidget({ query }: { query: ProviderQueryResult<EvaluationTask[]> }) {
  const { t } = useTranslation()
  const tasks = (query.data ?? []).filter((task) => task.status === "active")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          {t("app.evaluation")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <Link
            href="/dashboard/evaluation"
            className="flex items-center gap-3 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 text-sm">
              {t("dashboard.pendingEvaluation", { count: tasks.length })}
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </Link>
        </QueryState>
      </CardContent>
    </Card>
  )
}
