import "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { classifyYsuRequest, labelYsuRequest, ysuPluginTranslations } from "./activity"
import { createYsuSchoolProvider } from "./ysu-provider"
import { YSU_CONFIG } from "./ysu-config"

export const YSU_PROVIDER_PLUGIN_ID = "ysu.provider"

const YSU_PROVIDER_INJECT = [
  "i18n",
  "storage",
  "providers",
  "http",
  "session",
  "query",
  "native",
  "mfa",
] as const

export const manifest: PluginManifest = {
  id: YSU_PROVIDER_PLUGIN_ID,
  name: "燕山大学教务",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "provider",
  required: true,
  entry: "index.js",
  description: "燕山大学 CAS / 教务 / 移动端 / 缴费平台 Provider",
  inject: [...YSU_PROVIDER_INJECT],
}

export const ysuProviderPlugin = definePlugin({
  manifest,
  inject: YSU_PROVIDER_INJECT,
  apply(ctx) {
    ctx.i18n.register(ysuPluginTranslations)

    ctx.http.activity.registerLabeler((url) => labelYsuRequest(url))
    ctx.http.activity.registerClassifier((url) => classifyYsuRequest(url))

    ctx.providers.registerProvider(YSU_CONFIG.id, () =>
      createYsuSchoolProvider({
        session: ctx.session,
        http: ctx.http,
        storage: ctx.storage,
        native: ctx.native,
        i18n: ctx.i18n,
        query: ctx.query,
        mfa: ctx.mfa,
        appVersion: manifest.version,
      })
    )
  },
})

export const definition = ysuProviderPlugin
export default ysuProviderPlugin

export { classifyYsuRequest, labelYsuRequest, ysuPluginTranslations } from "./activity"
export { createAuthTransitionQueue, type AuthTransitionQueue } from "./auth-transition"
export {
  createYSUContext,
  createYSUUrls,
  type YSUContext,
  type YSUContextSource,
  type YSUUrls,
} from "./context"
export { letterOfGradeLevel, letterOfScore, YSU_GPA_SCALE, YSU_GRADE_SCALE } from "./grade-letters"
export {
  createYsuNativePolling,
  type NativeApiPath,
  type NativeFieldMappings,
  type NativeServerConfig,
  type YsuNativePolling,
} from "./native-polling"
export { getYSUMfaMethods, isYSUMfaMethod, type YSUMfaMethod } from "./types"
export {
  YSU_CONFIG,
  YSU_SECURE_KEY_CAS_TGC,
  YSU_SESSION_ARTIFACT_JWXT,
  YSU_SESSION_ARTIFACT_MOBILE,
  type YSUConfig,
} from "./ysu-config"
export { createYsuSchoolProvider, type YsuSchoolProvider } from "./ysu-provider"
