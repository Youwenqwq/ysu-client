import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import type { SchoolConfig } from "@orahako/plugin-sdk/provider-school"
import zmuConfig from "./zmu.json"
import { ZMUProvider } from "./zmu-provider"

export const manifest: PluginManifest = {
  id: "zmu.provider",
  name: "遵义医科大学教务",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "provider",
  required: false,
  entry: "index.js",
  description: "遵义医科大学乘方教务 Provider（验证码登录、学籍、课表、成绩与考试）",
}

export const definition = definePlugin((ctx) => {
  ctx.providers.registerSchool({
    config: zmuConfig as SchoolConfig,
    providerFactory: () => new ZMUProvider(),
  })
})

export default definition
