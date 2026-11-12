import { Gauge } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { ComprehensivePage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.comprehensive",
  name: "综合测评",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "综合测评",
    titleKey: "comprehensive.title",
    component: ComprehensivePage,
    capability: "comprehensiveEval",
  })
  ctx.ui.registerNavigation({
    id: "comprehensive",
    title: "综合测评",
    titleKey: "app.comprehensive",
    page: "index",
    icon: Gauge,
    group: "platform",
    order: 30,
    capability: "comprehensiveEval",
  })
})
