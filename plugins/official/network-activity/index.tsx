import { createElement } from "react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { NetworkActivityStrip } from "./strip"

export const manifest: PluginManifest = {
  id: "orahako.network-activity",
  name: "网络活动",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  requires: ["orahako.shell"],
  providerIndependent: true,
  description: "在顶栏下方显示当前网络请求分类、实时耗时与本轮汇总",
}

export const definition = definePlugin((ctx) => {
  ctx.i18n.register({
    zh: {
      networkActivity: {
        live: "加载中",
        summary: "本轮 {count} 次请求 · 总 {total} · 最慢 {slowest} {duration}",
        failed: " · {count} 个失败",
        category: {
          auth: "统一认证",
          academic: "教务系统",
          mobile: "移动教务",
          oneStop: "一站式",
          campus: "校园服务",
          payment: "缴费平台",
          wechat: "微信认证",
          other: "网络请求",
        },
      },
    },
    en: {
      networkActivity: {
        live: "Loading",
        summary: "{count} requests · {total} total · slowest {slowest} {duration}",
        failed: " · {count} failed",
        category: {
          auth: "Sign-in",
          academic: "Academic system",
          mobile: "Mobile academic",
          oneStop: "Campus portal",
          campus: "Campus services",
          payment: "Payments",
          wechat: "WeChat verification",
          other: "Network",
        },
      },
    },
  })

  ctx.slots.register({
    id: "activity-strip",
    slot: "shell.activity",
    component: () => createElement(NetworkActivityStrip, { activity: ctx.http.activity }),
  })
})
