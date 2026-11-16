import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { StudentInfoPage } from "./page"

export const manifest: PluginManifest = {
  id: "orahako.student-info",
  name: "学生信息",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["ui"],
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    route: "student-info",
    title: "学生信息",
    titleKey: "app.studentInfo",
    component: StudentInfoPage,
    capability: "studentInfo",
  })
})
