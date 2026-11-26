import { Puzzle } from "lucide-react"
import { defineDictionary, definePlugin, validatePluginManifest } from "@orahako/sdk"
import { Badge } from "@orahako/ui-primitives"
import manifest from "../manifest.json"
import { HelloPage } from "./page"
import "./style.css"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
  }
}

export const helloDictionary = defineDictionary({
  zh: { hello: { title: "示例插件", greeting: "你好，{name}！" } },
  en: { hello: { title: "Hello Plugin", greeting: "Hello, {name}!" } },
})

export default definePlugin({
  manifest: validatePluginManifest(manifest),
  inject: ["ui", "slots"] as const,
  apply(ctx) {
    ctx.slots.inject("shell.header.actions", (slotCtx) =>
      slotCtx.slots.register(
        { id: "header-greeting", slot: "shell.header.actions", dictionary: helloDictionary },
        ({ t }) => <Badge variant="secondary">{t("hello.greeting", { name: "Orahako" })}</Badge>
      )
    )
    ctx.ui.registerPage(
      {
        id: "index",
        title: "Hello Plugin",
        titleKey: "hello.title",
        dictionary: helloDictionary,
        requiresProvider: false,
      },
      HelloPage
    )
    ctx.ui.registerNavigation({
      id: "hello",
      title: "Hello Plugin",
      titleKey: "hello.title",
      page: "index",
      icon: Puzzle,
      group: "plugins",
    })
  },
})
