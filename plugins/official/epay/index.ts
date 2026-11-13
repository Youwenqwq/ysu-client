import { Wallet } from "lucide-react"
import { toast } from "sonner"
import {
  PLUGIN_API_VERSION,
  definePlugin,
  type PluginLocale,
  type PluginManifest,
} from "@orahako/plugin-sdk"
import { STORAGE_KEYS } from "@orahako/plugin-ui/stores"
import { runEpayAutoCheck } from "./auto-check"
import { EpayPage } from "./page"
import { EpayNotificationSettings } from "./settings"

export const manifest: PluginManifest = {
  id: "orahako.epay",
  name: "缴费查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
}

function currentLocale(): PluginLocale {
  if (typeof window === "undefined") return "zh"
  const locale = localStorage.getItem(STORAGE_KEYS.locale)
  return locale === "en" ? "en" : "zh"
}

export const definition = definePlugin((ctx) => {
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

  ctx.hostLifecycle.onProviderReady(async () => {
    const result = await runEpayAutoCheck()
    if (!result?.hasUnpaid) return
    toast.warning(
      ctx.i18n.t(
        "epay.unpaidNotify",
        { count: result.count, total: result.total.toFixed(2) },
        currentLocale()
      )
    )
  })
})
