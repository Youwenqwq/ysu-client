import { ClipboardCheck } from "lucide-react"
import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { EvaluationPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.evaluation",
  name: "学生评教",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "学生评教",
    titleKey: "evaluation.title",
    component: EvaluationPage,
    capability: "evaluation",
  })
  ctx.ui.registerNavigation({
    id: "evaluation",
    title: "学生评教",
    titleKey: "app.evaluation",
    page: "index",
    icon: ClipboardCheck,
    group: "academic",
    order: 60,
    capability: "evaluation",
  })
})
