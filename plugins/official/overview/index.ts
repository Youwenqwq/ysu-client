import { CalendarDays, LayoutDashboard } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { OverviewPage } from "./page"
import { OverviewSettingsPanel, OverviewStartupOption } from "./settings"
import { WeekSummaryWidget } from "@orahako/academic"

export const manifest: PluginManifest = {
  id: "orahako.overview",
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
    route: "overview",
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

  ctx.slots.register({
    id: "startup-option",
    slot: "settings.startupOptions",
    order: 10,
    component: OverviewStartupOption,
  })
  ctx.settings.registerCategory({
    id: "overview",
    order: 10,
    title: "总览",
    titleKey: "app.overview",
    description: "自定义总览布局",
    descriptionKey: "overviewLayout.settingsDescription",
    icon: LayoutDashboard,
    component: OverviewSettingsPanel,
  })

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
    order: 0,
  })
})
