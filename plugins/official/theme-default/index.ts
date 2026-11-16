import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"

export const manifest: PluginManifest = {
  id: "orahako.theme.default",
  name: "默认主题",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "theme",
  inject: ["ui"],
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerTheme({
    id: "default",
    name: "默认主题",
    css: "",
  })
})
