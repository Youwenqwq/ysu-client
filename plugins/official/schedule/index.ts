import { BookOpen, Calendar, Clock, LayoutGrid } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { SchedulePage } from "./page"
import {
  ClassReminderSettings,
  ScheduleStartupOption,
  ScheduleWidgetAssistantSettings,
  ScheduleWidgetSettingsPanel,
} from "./settings"
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
  ctx.notifications.register("schedule")
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
  ctx.slots.register({
    id: "startup-option",
    slot: "settings.startupOptions",
    order: 20,
    component: ScheduleStartupOption,
  })
  ctx.settings.registerCategory({
    id: "widgets",
    order: 40,
    title: "小组件",
    titleKey: "desktopWidgets.title",
    description: "添加与管理桌面小组件",
    descriptionKey: "settings.addWidgetDesc",
    icon: LayoutGrid,
    component: ScheduleWidgetSettingsPanel,
  })
  ctx.slots.register({
    id: "widget-assistant",
    slot: "settings.widgets",
    order: 10,
    component: ScheduleWidgetAssistantSettings,
  })
  ctx.slots.register({
    id: "class-reminder-settings",
    slot: "settings.notifications.reminders",
    order: 10,
    component: ClassReminderSettings,
  })
})
