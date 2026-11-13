import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { unregisterSchoolConfig } from "@orahako/plugin-sdk/host"
import type { SchoolConfig } from "@orahako/plugin-sdk/provider-school"
import ysuConfig from "./ysu.json"
import { NotifySettingsSection } from "./settings-notifications"
import { YSUProvider } from "./ysu-provider"

export const manifest: PluginManifest = {
  id: "ysu.provider",
  name: "燕山大学教务",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "provider",
  required: true,
  entry: "index.js",
  description: "燕山大学 CAS / 教务 / 移动端 / 缴费平台 Provider",
}

export const definition = definePlugin((ctx) => {
  const config = ysuConfig as SchoolConfig
  const disposeRegistration = ctx.providers.registerSchool({
    config,
    providerFactory: () => new YSUProvider(),
  })
  const disposeSettings = ctx.slots.register({
    id: "notifications",
    slot: "settings.sections",
    order: 45,
    component: NotifySettingsSection,
  })
  ctx.on("dispose", () => {
    disposeSettings()
    disposeRegistration()
    unregisterSchoolConfig(config)
  })
})

export type { YSUMfaMethod } from "./types"
export default definition
