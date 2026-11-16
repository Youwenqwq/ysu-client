import { Wallet } from "lucide-react"
import { toast } from "sonner"
import {
  PLUGIN_API_VERSION,
  definePlugin,
  type AcademicPluginContext,
  type PluginManifest,
} from "@orahako/plugin-sdk"
import { runEpayAutoCheck } from "./auto-check"
import { EpayPage } from "./page"
import { EpayNotificationSettings } from "./settings"

export const manifest: PluginManifest = {
  id: "orahako.epay",
  name: "缴费查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["ui", "slots", "i18n", "provider"],
  entry: "index.js",
}


export const definition = definePlugin((baseCtx) => {
  const ctx = baseCtx as unknown as AcademicPluginContext
  ctx.i18n.register({
    zh: {
      settings: { epayReminderTitle: "缴费提醒" },
      epay: {
        remindLabel: "未缴自动提醒",
        remindDesc: "打开应用时自动检查并提醒未缴费用",
      },
    },
    en: {
      settings: { epayReminderTitle: "Fee Reminder" },
      epay: {
        remindLabel: "Unpaid reminder",
        remindDesc: "Check and remind unpaid fees when the app opens",
      },
    },
  })

  ctx.ui.registerPage({
    id: "index",
    title: "缴费查询",
    titleKey: "epay.title",
    component: EpayPage,
    capability: "epay",
  })
  ctx.ui.registerNavigation({
    id: "epay",
    title: "缴费查询",
    titleKey: "epay.nav",
    page: "index",
    icon: Wallet,
    group: "fees",
    capability: "epay",
    order: 20,
  })

  ctx.slots.register({
    id: "reminder-settings",
    slot: "settings.notifications.appReminders",
    order: 20,
    component: EpayNotificationSettings,
  })

  const check = async () => {
    const result = await runEpayAutoCheck(ctx)
    if (!result?.hasUnpaid) return
    toast.warning(
      ctx.i18n.t(
        "epay.unpaidNotify",
        { count: result.count, total: result.total.toFixed(2) }
      )
    )
  }
  ctx.on("provider/ready", check)
  if (ctx.provider.getSnapshot().status === "ready") void check()
})
