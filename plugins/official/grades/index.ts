import { GraduationCap } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { GradesPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.grades",
  name: "成绩",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
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
