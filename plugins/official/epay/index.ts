import { Wallet } from "lucide-react"
import { toast } from "sonner"
import {
  PLUGIN_API_VERSION,
  definePlugin,
  type PluginLocale,
  type PluginManifest,
} from "@ysu/plugin-sdk"
import { registerFeeStartupCheck } from "@/lib/fees/startup"
import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "@/lib/storage/keys"
import { runEpayAutoCheck } from "./auto-check"
import { EpayPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.epay",
  name: "缴费查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
}

function currentLocale(): PluginLocale {
  if (typeof window === "undefined") return "zh"
  const locale = getLocalStorageItemWithFallback(STORAGE_KEYS.locale, STORAGE_KEYS.legacyLocale)
  return locale === "en" ? "en" : "zh"
}

export const definition = definePlugin((ctx) => {
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

  // 启动提醒：宿主在 Provider 初始化完成后运行已注册的检查。
  const unregister = registerFeeStartupCheck(async () => {
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
  ctx.on("dispose", unregister)
})
