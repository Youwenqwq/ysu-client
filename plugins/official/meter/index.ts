import { AirVent } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { MeterPage } from "./page"

export const manifest: PluginManifest = {
  id: "orahako.meter",
  name: "空调电费",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["ui", "http"],
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "空调电费",
    titleKey: "meter.title",
    component: MeterPage,
    capability: "meter",
  })
  ctx.ui.registerNavigation({
    id: "meter",
    title: "空调电费",
    titleKey: "meter.nav",
    page: "index",
    icon: AirVent,
    group: "fees",
    order: 30,
    capability: "meter",
  })
})
