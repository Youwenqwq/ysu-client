import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { arknightsThemeCss } from "./styles"

export const manifest: PluginManifest = {
  id: "community.theme.arknights",
  name: "明日方舟 × 新粗野主义",
  version: "1.0.1",
  apiVersion: 1,
  kind: "theme",
  entry: "index.js",
  description: "罗德岛终端视觉体系：石墨画布、2px 墨边、零圆角、硬偏移阴影、工程网格与青色信号。",
}

const definition = definePlugin((ctx) => {
  ctx.ui.registerTheme({
    id: "arknights",
    name: "明日方舟 × 新粗野主义",
    css: arknightsThemeCss,
  })
})

export default definition
