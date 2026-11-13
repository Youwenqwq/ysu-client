import { Calendar, FileText } from "lucide-react"
import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { ExamsPage } from "./page"
import { UpcomingExamsWidget } from "@ysu/academic"

export const manifest: PluginManifest = {
  id: "ysu.exams",
  name: "考试安排",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
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
