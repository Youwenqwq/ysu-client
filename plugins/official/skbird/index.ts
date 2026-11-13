import { Bird } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { SkbirdIndexPage } from "./pages/index"
import { SkbirdThreadPage } from "./pages/thread"
import { SkbirdMessagesPage } from "./pages/messages"
import { SkbirdMePage } from "./pages/me"
import { SkbirdSettingsPage } from "./pages/settings"

export const manifest: PluginManifest = {
  id: "orahako.skbird",
  name: "森空鸟",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerNavigation({
    id: "skbird",
    title: "森空鸟",
    titleKey: "skbird.nav",
    page: "index",
    icon: Bird,
    group: "extras",
  })

  ctx.ui.registerPage({
    id: "index",
    title: "森空鸟",
    titleKey: "skbird.title",
    component: SkbirdIndexPage,
  })
  ctx.ui.registerPage({
    id: "thread",
    title: "帖子详情",
    titleKey: "skbird.threadTitle",
    component: SkbirdThreadPage,
    parent: "index",
  })
  ctx.ui.registerPage({
    id: "messages",
    title: "消息",
    titleKey: "skbird.messagesTitle",
    component: SkbirdMessagesPage,
    parent: "index",
  })
  ctx.ui.registerPage({
    id: "me",
    title: "我的",
    titleKey: "skbird.meTitle",
    component: SkbirdMePage,
    parent: "index",
  })
  ctx.ui.registerPage({
    id: "settings",
    title: "森空鸟设置",
    titleKey: "skbird.settingsTitle",
    component: SkbirdSettingsPage,
    parent: "index",
  })
})
