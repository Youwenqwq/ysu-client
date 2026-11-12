import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@ysu/plugin-sdk"
import { unregisterSchoolConfig } from "@ysu/plugin-sdk/host"
import type { SchoolConfig } from "@ysu/plugin-sdk/provider-school"
import ysuConfig from "./ysu.json"
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
  ctx.on("dispose", () => {
    disposeRegistration()
    unregisterSchoolConfig(config)
  })
})

export type { YSUMfaMethod } from "./types"
export default definition
