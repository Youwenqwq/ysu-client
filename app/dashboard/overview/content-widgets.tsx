"use client"

import { useState } from "react"
import Link from "next/link"
import { BookOpen, Calendar, ChevronRight, ClipboardCheck, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import { formatExamTime, getExamStartTime } from "@/lib/academic/exam-utils"
import { getAcademicClock } from "@/lib/academic/academic-time"
import type { ScheduleOccurrence } from "@/lib/academic/schedule-patches"
import {
  courseEndSection,
  courseStartSection,
  isCoursePast,
} from "@/app/dashboard/schedule/schedule-utils"
import { buildCourseColorMap, courseInkClass } from "@/app/dashboard/schedule/course-color"
import { ActivityModal } from "@/app/dashboard/schedule/activity-modal"
import { SigninModal } from "@/app/dashboard/schedule/signin-modal"
import type { ProviderQueryResult } from "@/providers/hooks"
import type { Course, EvaluationTask } from "@/providers/types"
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
          <Clock className="size-4 text-brand" />
          <span className="flex flex-col">
            <span className="hud-label leading-none">{t("app.schedule")}</span>
            <span className="leading-tight">
              {t(currentCourse ? "dashboard.ongoingNow" : "dashboard.nextCourse")}
            </span>
          </span>
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
          {data.currentWeek.data === null && (
            <p className="text-sm text-muted-foreground">{t("overviewData.unavailableShort")}</p>
          )}
          {course && range && (
            <div className="flex flex-col gap-2">
              <Link
                href="/dashboard/schedule"
                className="rounded-none font-heading text-lg leading-tight font-semibold tracking-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {course.name}
              </Link>
              <p className="font-mono text-[0.7rem] tracking-wide text-muted-foreground">
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
              <p className="font-mono text-[0.7rem] tracking-wider text-muted-foreground tabular-nums">
                {clockText(range[0])} — {clockText(range[1])}
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
  const [activityCourse, setActivityCourse] = useState<Course | null>(null)
  const [activityWeek, setActivityWeek] = useState(1)
  const [activityOpen, setActivityOpen] = useState(false)
  const [signinActivityId, setSigninActivityId] = useState("")
  const [signinType, setSigninType] = useState(1)
  const [signinOpen, setSigninOpen] = useState(false)

  const colorMap = buildCourseColorMap(data.todayCourses)

  const openCourse = (course: Course) => {
    const occurrence =
      "occurrenceId" in course && "source" in course ? (course as ScheduleOccurrence) : null
    setActivityCourse(occurrence?.source.course ?? course)
    setActivityWeek(occurrence?.source.week ?? data.currentWeek.data?.week ?? 1)
    setActivityOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-brand" />
            <span className="flex flex-col">
              <span className="hud-label leading-none">{t("app.schedule")}</span>
              <span className="leading-tight">{t("dashboard.todayCourses")}</span>
            </span>
          </CardTitle>
          <Link
            href="/dashboard/schedule"
            aria-label={t("app.schedule")}
            className="flex size-7 items-center justify-center border border-edge/40 text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <ChevronRight className="size-4" />
          </Link>
        </CardHeader>
        <CardContent>
          <QueryState queries={[data.schedule, data.currentWeek]}>
            {data.currentWeek.data === null ? (
              <p className="text-sm text-muted-foreground">{t("overviewData.unavailableShort")}</p>
            ) : data.todayCourses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noCoursesToday")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.todayCourses.map((course, index) => {
                  const isCurrent = course === data.currentCourse
                  const isPast = !isCurrent && isCoursePast(course, data.nowMinutes, data.timeMap)
                  const range = data.courseTimeRange(course)
                  return (
                    <button
                      key={`${course.scheduleId ?? course.name}-${course.startSection}-${index}`}
                      type="button"
                      onClick={() => openCourse(course)}
                      className={cn(
                        "flex w-full items-center gap-3 border-y border-r border-l-[3px] border-edge/25 border-y-edge/25 border-r-edge/25 bg-background/40 p-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-brand/40",
                        courseInkClass(colorMap, course),
                        isCurrent && "border-y-brand/40 border-r-brand/40 bg-brand/10",
                        isPast && "opacity-50"
                      )}
                    >
                      {range && (
                        <div className="hud-data flex w-11 shrink-0 flex-col text-[0.65rem] leading-tight text-muted-foreground">
                          <span>{clockText(range[0])}</span>
                          <span>{clockText(range[1])}</span>
                        </div>
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{course.name}</span>
                        <span className="font-mono text-[0.65rem] tracking-wide text-muted-foreground">
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
                    </button>
                  )
                })}
              </div>
            )}
          </QueryState>
        </CardContent>
      </Card>
      <ActivityModal
        course={activityCourse}
        week={activityWeek}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onSigninActivity={(activityId, type) => {
          setSigninActivityId(activityId)
          setSigninType(type)
          setSigninOpen(true)
        }}
      />
      <SigninModal
        activityId={signinActivityId}
        signinType={signinType}
        open={signinOpen}
        onOpenChange={setSigninOpen}
      />
    </>
  )
}

export function UpcomingExamsWidget({ data }: { data: OverviewSchedule }) {
  const { t } = useTranslation()
  const today = Date.parse(data.date)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-4 text-brand" />
          <span className="flex flex-col">
            <span className="hud-label leading-none">{t("app.academic")}</span>
            <span className="leading-tight">{t("dashboard.upcomingExams")}</span>
          </span>
        </CardTitle>
        <Link
          href="/dashboard/exams"
          className="rounded-none p-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-brand/40"
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
                  ? Math.round((Date.parse(getAcademicClock(date).date) - today) / 86_400_000)
                  : null
                return (
                  <div
                    key={`${exam.name}-${exam.startAt}-${index}`}
                    className="flex items-center justify-between gap-2 border border-l-2 border-edge/25 border-l-hazard bg-background/40 p-2.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[0.8rem] font-medium">{exam.name}</span>
                      <span className="font-mono text-[0.65rem] tracking-wide text-muted-foreground">
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
          <ClipboardCheck className="size-4 text-brand" />
          {t("app.evaluation")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <Link
            href="/dashboard/evaluation"
            className="flex items-center gap-3 rounded-none outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
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
