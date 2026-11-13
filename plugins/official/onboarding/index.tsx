import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { OnboardingWizard } from "./panel"

export const manifest: PluginManifest = {
  id: "orahako.onboarding",
  name: "初始化向导",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  required: true,
}

export const definition = definePlugin((ctx) => {
  ctx.i18n.register({
    zh: {
      onboarding: {
        title: "初次设置",
        chooseSchool: "选择学校",
        online: "在线插件",
        continue: "继续",
        installing: "正在获取",
        installFailed: "获取失败，请重试",
        permissions: "权限",
        notifications: "通知",
        exactAlarm: "精确提醒",
        battery: "后台运行",
        noPermissions: "暂无需要配置的权限",
        allow: "允许",
        enabled: "已允许",
        retry: "重试",
        back: "返回",
        skip: "跳过",
        finish: "完成",
      },
    },
    en: {
      onboarding: {
        title: "Setup",
        chooseSchool: "Choose your school",
        online: "Online plugin",
        continue: "Continue",
        installing: "Downloading",
        installFailed: "Download failed. Try again.",
        permissions: "Permissions",
        notifications: "Notifications",
        exactAlarm: "Exact reminders",
        battery: "Background activity",
        noPermissions: "No permissions to configure",
        allow: "Allow",
        enabled: "Allowed",
        retry: "Retry",
        back: "Back",
        skip: "Skip",
        finish: "Finish",
      },
    },
  })
  ctx.slots.register({
    id: "onboarding",
    slot: "shell.overlay",
    order: -100,
    component: () => (
      <OnboardingWizard
        installFromMarket={ctx.plugins.installFromMarket}
        hasProvider={ctx.providers.hasProvider}
        native={ctx.native}
      />
    ),
  })
})

export default definition
