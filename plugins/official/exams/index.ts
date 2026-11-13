import { Calendar, FileText } from "lucide-react"
import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { ExamsPage } from "./page"
import { ExamCompactSettingsWidget, ExamNotificationContent, ExamSettingsWidget } from "./settings"
import { UpcomingExamsWidget } from "@orahako/academic"

export const manifest: PluginManifest = {
  id: "orahako.exams",
  name: "考试安排",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.notifications.register("exams")
  ctx.ui.registerOverviewWidget({
    id: "upcoming-exams",
    title: "近期考试",
    titleKey: "overviewLayout.widgets.upcomingExams.title",
    description: "查看接下来的考试时间与地点。",
    descriptionKey: "overviewLayout.widgets.upcomingExams.description",
    icon: Calendar,
    component: UpcomingExamsWidget,
    region: "content",
    defaultVisible: true,
    order: 60,
  })
  ctx.slots.register({
    id: "exams",
    slot: "settings.notifications.content",
    order: 20,
    component: ExamNotificationContent,
  })
  ctx.slots.register({
    id: "exam",
    slot: "settings.widgets",
    order: 20,
    component: ExamSettingsWidget,
  })
  ctx.slots.register({
    id: "exam-compact",
    slot: "settings.widgets",
    order: 20,
    component: ExamCompactSettingsWidget,
  })
  ctx.ui.registerPage({
    id: "index",
    title: "考试安排",
    titleKey: "exams.title",
    component: ExamsPage,
    capability: "exams",
  })
  ctx.ui.registerNavigation({
    id: "exams",
    title: "考试安排",
    titleKey: "app.exams",
    page: "index",
    icon: FileText,
    group: "academic",
    order: 30,
    capability: "exams",
  })
})
