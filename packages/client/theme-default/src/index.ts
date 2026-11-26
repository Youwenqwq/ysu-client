import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"

export const THEME_DEFAULT_PLUGIN_ID = "orahako.theme.default"

export const manifest: PluginManifest = {
  id: THEME_DEFAULT_PLUGIN_ID,
  name: "默认主题",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "theme",
  entry: "index.js",
  inject: ["ui"],
}

export const themeDefaultPlugin = definePlugin({
  manifest,
  inject: ["ui"] as const,
  apply(ctx) {
    ctx.ui.registerTheme({
      id: "default",
      name: "默认主题",
      css: "",
    })
  },
})

export const defaultThemePlugin = themeDefaultPlugin
export default themeDefaultPlugin
