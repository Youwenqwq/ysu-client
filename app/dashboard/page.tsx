"use client"

import type { ReactNode } from "react"
import { useEvaluationTasks } from "@/providers/hooks"
import { OverviewComposer } from "./overview/overview-composer"
import type { ContentWidgetId, SummaryWidgetId } from "./overview/layout-config"
import { useOverviewSchedule } from "./overview/use-overview-schedule"
import { EcardSummary } from "./overview/ecard-summary"
import {
  EvaluationSummary,
  GpaSummary,
  ProfileWidget,
  WeekSummary,
} from "./overview/summary-widgets"
import {
  CourseProgressWidget,
  EvaluationTasksWidget,
  TodayCoursesWidget,
  UpcomingExamsWidget,
} from "./overview/content-widgets"

export default function DashboardPage() {
  // These page-lifetime subscriptions also feed native widgets and class reminders.
  // Hiding a card must not stop their synchronization while the overview is mounted.
  const schedule = useOverviewSchedule()
  const evaluation = useEvaluationTasks()

  const renderSummary = (id: SummaryWidgetId, compact: boolean) => {
    switch (id) {
      case "week":
        return <WeekSummary data={schedule} compact={compact} />
      case "ecard":
        return <EcardSummary compact={compact} />
      case "gpa":
        return <GpaSummary compact={compact} />
      case "evaluation":
        return <EvaluationSummary query={evaluation} compact={compact} />
    }
  }
  const renderContent = (id: ContentWidgetId) => {
    switch (id) {
      case "course-progress": {
        const queries = [schedule.schedule, schedule.currentWeek, schedule.periodsRaw]
        const settled = queries.every((query) => query.data != null && !query.error)
        if (settled && !schedule.currentCourse && !schedule.nextCourseInfo) return null
        return <CourseProgressWidget data={schedule} />
      }
      case "today-courses":
        return <TodayCoursesWidget data={schedule} />
      case "upcoming-exams":
        return <UpcomingExamsWidget data={schedule} />
      case "evaluation-tasks":
        if (
          evaluation.data &&
          !evaluation.error &&
          !evaluation.data.some((task) => task.status === "active")
        )
          return null
        return <EvaluationTasksWidget query={evaluation} />
    }
  }

  return (
    <OverviewComposer
      renderProfile={(compact: boolean, summaries?: ReactNode) => (
        <ProfileWidget compact={compact}>{summaries}</ProfileWidget>
      )}
      renderSummary={renderSummary}
      renderContent={renderContent}
    />
  )
}
