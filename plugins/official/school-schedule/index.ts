import { CalendarDays } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { SchoolSchedulePage } from "./page"

export const manifest: PluginManifest = {
  id: "orahako.school-schedule",
  name: "全校课表",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["ui"],
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "全校课表",
    titleKey: "schoolSchedule.title",
    component: SchoolSchedulePage,
    capability: "schoolSchedule",
  })
  ctx.ui.registerNavigation({
    id: "school-schedule",
    title: "全校课表",
    titleKey: "app.schoolSchedule",
    page: "index",
    icon: CalendarDays,
    group: "platform",
    order: 40,
    capability: "schoolSchedule",
  })
})
