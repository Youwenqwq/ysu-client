import { CreditCard } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { EcardPage } from "./page"
import { EcardSummaryWidget } from "./summary-widget"

export const manifest: PluginManifest = {
  id: "ysu.ecard",
  name: "一卡通余额",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerOverviewWidget({
    id: "ecard",
    title: "一卡通余额",
    titleKey: "overviewLayout.widgets.ecard.title",
    description: "查看一卡通余额，点击进入详情页。",
    descriptionKey: "overviewLayout.widgets.ecard.description",
    icon: CreditCard,
    component: EcardSummaryWidget,
    region: "summary",
    defaultVisible: true,
    order: 10,
  })
  ctx.ui.registerPage({
    id: "index",
    title: "一卡通余额",
    titleKey: "ecard.title",
    component: EcardPage,
    capability: "ecard",
  })
  ctx.ui.registerNavigation({
    id: "ecard",
    title: "一卡通余额",
    titleKey: "ecard.nav",
    page: "index",
    icon: CreditCard,
    group: "fees",
    capability: "ecard",
    order: 10,
  })
})
