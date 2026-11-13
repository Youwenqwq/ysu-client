import { Puzzle } from "lucide-react"
import { definePlugin } from "@orahako/plugin-sdk"
import { HelloPage } from "./page"
import "./style.css"

function HeaderExtension() {
  return <span className="text-xs text-muted-foreground">Hello, plugin UI!</span>
}

export default definePlugin((ctx) => {
  ctx.i18n.register({
    zh: { hello: { title: "示例插件", greeting: "你好，{name}！" } },
    en: { hello: { title: "Hello Plugin", greeting: "Hello, {name}!" } },
  })
  ctx.slots.register({
    id: "header-greeting",
    slot: "dashboard.header.actions",
    component: HeaderExtension,
  })
  ctx.ui.registerPage({
    id: "index",
    title: "Hello Plugin",
    titleKey: "hello.title",
    component: HelloPage,
    primary: false,
  })
  ctx.ui.registerNavigation({
    id: "hello",
    title: "Hello Plugin",
    titleKey: "hello.title",
    page: "index",
    icon: Puzzle,
    group: "plugins",
  })
})
