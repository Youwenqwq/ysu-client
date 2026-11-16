import { Hammer } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { LaborPage } from "./page"

export const manifest: PluginManifest = {
  id: "orahako.labor",
  name: "劳动教育",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["ui"],
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "劳动教育",
    titleKey: "labor.title",
    component: LaborPage,
    capability: "laborEducation",
  })
  ctx.ui.registerNavigation({
    id: "labor",
    title: "劳动教育",
    titleKey: "app.labor",
    page: "index",
    icon: Hammer,
    group: "platform",
    order: 10,
    capability: "laborEducation",
  })
})
