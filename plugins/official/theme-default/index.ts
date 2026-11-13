import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"

export const manifest: PluginManifest = {
  id: "ysu.theme.default",
  name: "默认主题",
  version: "1.0.0",
  apiVersion: 1,
  kind: "theme",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerTheme({
    id: "default",
    name: "默认主题",
    css: "",
  })
})
