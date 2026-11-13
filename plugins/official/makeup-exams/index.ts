import { FilePenLine } from "lucide-react"
import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { MakeupExamsPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.makeup-exams",
  name: "补考查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "补考查询",
    titleKey: "makeupExams.title",
    component: MakeupExamsPage,
    capability: "makeupExams",
  })
  ctx.ui.registerNavigation({
    id: "makeup-exams",
    title: "补考查询",
    titleKey: "app.makeupExams",
    page: "index",
    icon: FilePenLine,
    group: "academic",
    order: 40,
    capability: "makeupExams",
  })
})
