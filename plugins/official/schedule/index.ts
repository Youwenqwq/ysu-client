import { BookOpen, Calendar, Clock } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { SchedulePage } from "./page"
import { CourseProgressWidget, TodayCoursesWidget } from "@orahako/academic"

export const manifest: PluginManifest = {
  id: "orahako.schedule",
  name: "日程",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerOverviewWidget({
    id: "course-progress",
    title: "课程动态",
    titleKey: "overviewLayout.widgets.courseProgress.title",
    description: "有课时显示正在进行或下一节课程。",
    descriptionKey: "overviewLayout.widgets.courseProgress.description",
    icon: Clock,
    component: CourseProgressWidget,
    region: "content",
    defaultVisible: true,
    order: 40,
  })
  ctx.ui.registerOverviewWidget({
    id: "today-courses",
    title: "今日课程",
    titleKey: "overviewLayout.widgets.todayCourses.title",
    description: "显示今天的课程与上课安排。",
    descriptionKey: "overviewLayout.widgets.todayCourses.description",
    icon: BookOpen,
    component: TodayCoursesWidget,
    region: "content",
    defaultVisible: true,
    order: 50,
  })
  ctx.ui.registerPage({
    id: "index",
    route: "schedule",
    title: "日程查询",
    titleKey: "schedule.title",
    component: SchedulePage,
    capability: "schedule",
    primary: true,
    fullscreen: true,
  })
  ctx.ui.registerNavigation({
    id: "schedule",
    title: "日程",
    titleKey: "app.schedule",
    page: "index",
    icon: Calendar,
    group: "main",
    order: 10,
    capability: "schedule",
    primary: true,
  })
})
