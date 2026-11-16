import {
  PLUGIN_API_VERSION,
  definePlugin,
  type AcademicPluginContext,
  type PluginConfig,
  type PluginDefinition,
  type PluginManifest,
} from "@orahako/plugin-sdk"
import { OnboardingWizard, type OnboardingSchool } from "./panel"

export type { OnboardingSchool }

export type OnboardingConfig = PluginConfig & {
  /**
   * School choices supplied by the application composition. The first entry is
   * the default selection; `id` is the provider school id, `providerId` is the
   * market plugin id, and `online` marks market-distributed providers.
   */
  schools: OnboardingSchool[]
}

/** Applies the schema-validated composition config with a safe runtime fallback. */
function resolveOnboardingConfig(config: PluginConfig): OnboardingConfig {
  return {
    ...config,
    schools: Array.isArray(config.schools) ? (config.schools as OnboardingSchool[]) : [],
  }
}

export const manifest: PluginManifest = {
  id: "orahako.onboarding",
  name: "初始化向导",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  inject: ["slots", "i18n", "providers", "plugins", "native", "provider"],
  entry: "index.js",
  required: true,
  configSchema: {
    type: "object",
    required: ["schools"],
    properties: {
      schools: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "name", "providerId"],
          properties: {
            id: { type: "string", minLength: 1 },
            name: { type: "string", minLength: 1 },
            nameEn: { type: "string", minLength: 1 },
            providerId: { type: "string", minLength: 1 },
            online: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  },
}

export const definition: PluginDefinition = definePlugin((baseCtx, config: PluginConfig) => {
  const ctx = baseCtx as unknown as AcademicPluginContext
  const { schools } = resolveOnboardingConfig(config)
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
        schools={schools}
        installFromMarket={(pluginId) => ctx.plugins.installFromMarket(pluginId)}
        hasProvider={(schoolId) => ctx.providers.hasProvider(schoolId)}
        selectSchool={(schoolId) => {
          ctx.provider.selectSchool(schoolId)
        }}
        native={ctx.native}
      />
    ),
  })
})

export default definition
