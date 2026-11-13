import { Lightbulb } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { CreditsPage } from "./page"

export const manifest: PluginManifest = {
  id: "orahako.credits",
  name: "双创学分",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "双创学分",
    titleKey: "credits.title",
    component: CreditsPage,
    capability: "innovationCredits",
  })
  ctx.ui.registerNavigation({
    id: "credits",
    title: "双创学分",
    titleKey: "app.credits",
    page: "index",
    icon: Lightbulb,
    group: "platform",
    order: 20,
    capability: "innovationCredits",
  })
})
