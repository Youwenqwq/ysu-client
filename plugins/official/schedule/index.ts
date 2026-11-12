import { Calendar } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { SchedulePage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.schedule",
  name: "日程",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "日程查询",
    titleKey: "schedule.title",
    component: SchedulePage,
    capability: "schedule",
    primary: true,
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
