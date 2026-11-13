import { createElement } from "react"
import { Bell } from "lucide-react"
import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { NotificationSettingsPanel } from "./settings"
import { NotificationRuntime } from "./runtime"

export const manifest: PluginManifest = {
  id: "orahako.notifications",
  name: "通知",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  required: true,
  entry: "index.js",
  description: "系统权限、通知轮询与提醒设置",
}

export const definition = definePlugin((ctx) => {
  const notifications = ctx.notifications
  ctx.slots.declare({ name: "settings.notifications.content", kind: "list" })
  ctx.slots.declare({ name: "settings.notifications.reminders", kind: "list" })
  ctx.slots.declare({ name: "settings.notifications.appReminders", kind: "list" })
  ctx.settings.registerCategory({
    id: "notifications",
    order: 20,
    title: "通知设置",
    titleKey: "settings.notifyTitle",
    description: "管理通知权限、轮询与提醒",
    descriptionKey: "settings.notifyDescription",
    icon: Bell,
    component: NotificationSettingsPanel,
  })
  ctx.slots.register({
    id: "runtime",
    slot: "shell.overlay",
    component: () => createElement(NotificationRuntime, { notifications }),
  })
})

export default definition
