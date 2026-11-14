import { definePlugin, validatePluginManifest } from "@orahako/plugin-sdk"
import { createThemeCss } from "./styles"
import manifestJson from "./manifest.json"

export const manifest = validatePluginManifest(manifestJson)

export default definePlugin((ctx) => {
  for (const [id, name] of [
    ["102", "YUNA · 102"],
    ["arknights", "YUNA · 明日方舟"],
    ["scarlet", "YUNA · 红魔馆"],
  ] as const) {
    ctx.ui.registerTheme({ id, name, css: createThemeCss(id, (path) => ctx.assets.url(path)) })
  }
})
