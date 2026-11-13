import { GraduationCap } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { GradesPage } from "./page"
import { GradeNotificationContent, GradesGachaSettingsSection } from "./settings"
import { useGradeGachaStore } from "./grade-gacha-store"
import { GpaSummaryWidget } from "@orahako/academic"

export const manifest: PluginManifest = {
  id: "orahako.grades",
  name: "成绩",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
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
    order: 20,
  })
  ctx.slots.register({
    id: "settings",
    slot: "settings.sections",
    order: 30,
    component: GradesGachaSettingsSection,
  })
  ctx.slots.register({
    id: "notification-content",
    slot: "settings.notificationContent",
    order: 10,
    component: GradeNotificationContent,
  })
  ctx.ui.registerPage({
    id: "index",
    title: "成绩查询",
    titleKey: "grades.title",
    component: GradesPage,
    capability: "grades",
    primary: true,
  })
  ctx.ui.registerNavigation({
    id: "grades",
    title: "成绩",
    titleKey: "app.grades",
    page: "index",
    icon: GraduationCap,
    group: "main",
    order: 20,
    capability: "grades",
    primary: true,
  })
  ctx.on("dispose", () => useGradeGachaStore.getState().setBaseline([]))
})
