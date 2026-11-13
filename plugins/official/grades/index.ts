import { GraduationCap } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { GradesPage } from "./page"
import { GpaSummaryWidget } from "@ysu/academic"

export const manifest: PluginManifest = {
  id: "ysu.grades",
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
})
