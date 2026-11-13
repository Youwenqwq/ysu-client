import { BookOpen } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { TrainingPlanPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.training-plan",
  name: "培养方案",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "培养方案",
    titleKey: "trainingPlan.title",
    component: TrainingPlanPage,
    capability: "trainingPlan",
  })
  ctx.ui.registerNavigation({
    id: "training-plan",
    title: "培养方案",
    titleKey: "app.trainingPlan",
    page: "index",
    icon: BookOpen,
    group: "academic",
    order: 50,
    capability: "trainingPlan",
  })
})
