import {
  BookOpen,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
} from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { OverviewPage } from "./page"
import { EcardSummaryWidget } from "./ecard-summary"
import { EvaluationSummaryWidget, GpaSummaryWidget, WeekSummaryWidget } from "./summary-widgets"
import {
  CourseProgressWidget,
  EvaluationTasksWidget,
  TodayCoursesWidget,
  UpcomingExamsWidget,
} from "./content-widgets"

export const manifest: PluginManifest = {
  id: "ysu.overview",
  name: "总览",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "总览",
    titleKey: "app.overview",
    component: OverviewPage,
    primary: true,
  })
  ctx.ui.registerNavigation({
    id: "overview",
    title: "总览",
    titleKey: "app.overview",
    page: "index",
    icon: LayoutDashboard,
    group: "main",
    order: 0,
    primary: true,
  })

  // Registration order is the default overview order; saved layouts keep their own.
  ctx.ui.registerOverviewWidget({
    id: "week",
    title: "学期信息",
    titleKey: "overviewLayout.widgets.week.title",
    description: "查看当前教学周、星期与学期。",
    descriptionKey: "overviewLayout.widgets.week.description",
    icon: CalendarDays,
    component: WeekSummaryWidget,
    region: "summary",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "ecard",
    title: "一卡通余额",
    titleKey: "overviewLayout.widgets.ecard.title",
    description: "查看一卡通余额，点击进入详情页。",
    descriptionKey: "overviewLayout.widgets.ecard.description",
    icon: CreditCard,
    component: EcardSummaryWidget,
    region: "summary",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "gpa",
    title: "平均绩点",
    titleKey: "overviewLayout.widgets.gpa.title",
    description: "查看绩点与平均成绩，可隐藏成绩数值。",
    descriptionKey: "overviewLayout.widgets.gpa.description",
    icon: GraduationCap,
    component: GpaSummaryWidget,
    region: "summary",
    defaultVisible: false,
  })
  ctx.ui.registerOverviewWidget({
    id: "evaluation",
    title: "评教状态",
    titleKey: "overviewLayout.widgets.evaluation.title",
    description: "查看待完成的学生评教数量。",
    descriptionKey: "overviewLayout.widgets.evaluation.description",
    icon: ClipboardCheck,
    component: EvaluationSummaryWidget,
    region: "summary",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "course-progress",
    title: "课程动态",
    titleKey: "overviewLayout.widgets.courseProgress.title",
    description: "有课时显示正在进行或下一节课程。",
    descriptionKey: "overviewLayout.widgets.courseProgress.description",
    icon: BookOpen,
    component: CourseProgressWidget,
    region: "content",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "today-courses",
    title: "今日课程",
    titleKey: "overviewLayout.widgets.todayCourses.title",
    description: "显示今天的课程与上课安排。",
    descriptionKey: "overviewLayout.widgets.todayCourses.description",
    icon: CalendarRange,
    component: TodayCoursesWidget,
    region: "content",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "upcoming-exams",
    title: "近期考试",
    titleKey: "overviewLayout.widgets.upcomingExams.title",
    description: "查看接下来的考试时间与地点。",
    descriptionKey: "overviewLayout.widgets.upcomingExams.description",
    icon: GraduationCap,
    component: UpcomingExamsWidget,
    region: "content",
    defaultVisible: true,
  })
  ctx.ui.registerOverviewWidget({
    id: "evaluation-tasks",
    title: "评教任务",
    titleKey: "overviewLayout.widgets.evaluationTasks.title",
    description: "有待办时显示需要完成的评教任务。",
    descriptionKey: "overviewLayout.widgets.evaluationTasks.description",
    icon: ListChecks,
    component: EvaluationTasksWidget,
    region: "content",
    defaultVisible: true,
  })
})
