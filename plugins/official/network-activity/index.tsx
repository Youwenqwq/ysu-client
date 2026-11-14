import { createElement } from "react"
import { Activity } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/plugin-sdk"
import { NetworkActivitySettings } from "./settings"
import { loadActivitySettings } from "./state"
import { NetworkActivityIndicator } from "./strip"

export const manifest: PluginManifest = {
  id: "orahako.network-activity",
  name: "网络活动",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  requires: ["orahako.shell"],
  providerIndependent: true,
  description: "在顶栏显示当前网络请求与耗时，可切换简洁、详细和调试模式",
}

export const definition = definePlugin((ctx) => {
  void loadActivitySettings(ctx.storage.local)

  ctx.i18n.register({
    zh: {
      networkActivity: {
        live: "加载中",
        summary: "本轮 {count} 次请求 · 总 {total} · 最慢 {slowest} {duration}",
        failed: " · {count} 个失败",
        status: {
          loading: "加载中",
          ok: "完成",
          error: "失败",
          aborted: "中止",
        },
        debug: {
          title: "加载流",
          active: "{count} 个请求进行中",
        },
        settings: {
          title: "网络活动",
          description: "控制顶栏网络加载提示的详细程度",
          density: "显示模式",
          densityDescription: "选择顶栏中网络活动信息的密度。",
          showTiming: "简洁模式显示计时",
          showTimingDescription:
            "在简洁模式下显示当前加载条目的实时耗时；详细和调试模式始终显示计时。",
          compact: "简洁",
          detailed: "详细",
          debug: "调试",
          compactDescription: "只在顶栏转圈左侧显示当前加载条目。",
          detailedDescription: "顶栏下方显示实时条目与本轮汇总。",
          debugDescription: "顶栏下方显示完整加载流，包括已完成请求。",
        },
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
        status: {
          loading: "Loading",
          ok: "Done",
          error: "Failed",
          aborted: "Aborted",
        },
        debug: {
          title: "Load flow",
          active: "{count} requests in flight",
        },
        settings: {
          title: "Network activity",
          description: "Control how much network activity detail appears in the top bar",
          density: "Display mode",
          densityDescription: "Choose the density of network activity information in the top bar.",
          showTiming: "Show timing in compact mode",
          showTimingDescription:
            "Show the live duration of the current item in compact mode. Detailed and debug modes always show timing.",
          compact: "Compact",
          detailed: "Detailed",
          debug: "Debug",
          compactDescription: "Show the current loading item next to the top-bar spinner.",
          detailedDescription: "Show live items and the burst summary below the top bar.",
          debugDescription: "Show the complete load flow, including completed requests.",
        },
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

  ctx.settings.registerCategory({
    id: "network-activity",
    order: 60,
    title: "网络活动",
    titleKey: "networkActivity.settings.title",
    description: "控制顶栏网络加载提示的详细程度",
    descriptionKey: "networkActivity.settings.description",
    icon: Activity,
    component: () => createElement(NetworkActivitySettings, { storage: ctx.storage.local }),
  })

  ctx.slots.register({
    id: "activity-strip",
    slot: "shell.activity",
    component: () => createElement(NetworkActivityIndicator, { activity: ctx.http.activity }),
  })
})
