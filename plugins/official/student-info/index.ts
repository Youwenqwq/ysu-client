import { definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { StudentInfoPage } from "./page"

export const manifest: PluginManifest = {
  id: "ysu.student-info",
  name: "学生信息",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerPage({
    id: "index",
    title: "学生信息",
    titleKey: "app.studentInfo",
    component: StudentInfoPage,
    capability: "studentInfo",
  })
})
