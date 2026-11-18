import type { Context } from "@cordisjs/core"
import { Server } from "lucide-react"
import "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { classifyYsuRequest, labelYsuRequest, ysuPluginTranslations } from "./activity"
import {
  resolveYsuEndpointUrls,
  ysuEndpointStore,
  ysuSettingsDictionary,
  type YsuEndpointCategoryInject,
  type YsuEndpointState,
} from "./endpoints"
import { YsuEndpointSettingsPanel } from "./settings-panel"
import { createYsuSchoolProvider } from "./ysu-provider"
import { YSU_CONFIG } from "./ysu-config"

export const YSU_PROVIDER_PLUGIN_ID = "ysu.provider"
export const YSU_ENDPOINTS_CATEGORY_ID = "ysu-endpoints"

const YSU_PROVIDER_INJECT = [
  "i18n",
  "settings",
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

function collectCustomHosts(state: YsuEndpointState): ReadonlySet<string> | undefined {
  if (!state.customCerBaseUrl && !state.customJwxtBaseUrl) return undefined
  const resolved = resolveYsuEndpointUrls(state, YSU_CONFIG)
  const hosts = new Set<string>()
  for (const raw of [resolved.cerBaseUrl, resolved.jwxtBaseUrl]) {
    try {
      hosts.add(new URL(raw).hostname.toLowerCase())
    } catch {
      // Ignore malformed custom URL in activity host matching.
    }
  }
  return hosts.size > 0 ? hosts : undefined
}

async function resetActiveYsuProvider(registrantCtx: Context): Promise<void> {
  const providerRuntime = registrantCtx.get("provider")
  if (!providerRuntime) return
  const snapshot = providerRuntime.getSnapshot()
  if (snapshot.schoolId !== YSU_CONFIG.id || !snapshot.provider) return
  const shouldReinitialize = snapshot.status === "ready" || snapshot.status === "error"
  await providerRuntime.reset()
  if (shouldReinitialize) {
    await providerRuntime.initialize().catch(() => {
      // ProviderRuntime records initialization errors on its own snapshot.
    })
  }
}

export const ysuProviderPlugin = definePlugin({
  manifest,
  inject: YSU_PROVIDER_INJECT,
  apply(ctx) {
    const endpointStore = ysuEndpointStore.create(ctx.storage)
    ctx.effect(() => () => endpointStore.dispose())

    ctx.i18n.register(ysuPluginTranslations)
    ctx.i18n.register(ysuSettingsDictionary)

    ctx.http.activity.registerLabeler((url) =>
      labelYsuRequest(url, collectCustomHosts(endpointStore.source.getSnapshot()))
    )
    ctx.http.activity.registerClassifier((url) =>
      classifyYsuRequest(url, collectCustomHosts(endpointStore.source.getSnapshot()))
    )

    ctx.settings.registerCategory(
      {
        id: YSU_ENDPOINTS_CATEGORY_ID,
        title: "燕山大学服务节点",
        titleKey: "categoryTitle",
        description: "自定义统一身份认证（CAS）与教务系统（JWXT）服务器地址",
        descriptionKey: "categoryDescription",
        icon: Server,
        order: 60,
        dictionary: ysuSettingsDictionary,
        store: endpointStore,
        inject: (registrantCtx: Context): YsuEndpointCategoryInject => ({
          defaultCerBaseUrl: YSU_CONFIG.cas.cerBaseUrl,
          defaultJwxtBaseUrl: YSU_CONFIG.jwxt.jwxtBaseUrl,
          onEndpointsChanged: () => resetActiveYsuProvider(registrantCtx),
        }),
      },
      YsuEndpointSettingsPanel
    )

    ctx.providers.registerProvider(YSU_CONFIG.id, () =>
      createYsuSchoolProvider({
        session: ctx.session,
        http: ctx.http,
        storage: ctx.storage,
        native: ctx.native,
        i18n: ctx.i18n,
        query: ctx.query,
        mfa: ctx.mfa,
        getEndpoints: () => endpointStore.source.getSnapshot(),
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
export {
  isValidHttpBaseUrl,
  normalizeEndpointBaseUrl,
  resolveYsuEndpointUrls,
  ysuEndpointStore,
  ysuSettingsDictionary,
  type ResolvedYsuEndpoints,
  type YsuEndpointCategoryInject,
  type YsuEndpointState,
  type YsuEndpointStoreInstance,
} from "./endpoints"
export { letterOfGradeLevel, letterOfScore, YSU_GPA_SCALE, YSU_GRADE_SCALE } from "./grade-letters"
export {
  createYsuNativePolling,
  type NativeApiPath,
  type NativeFieldMappings,
  type NativeServerConfig,
  type YsuNativePolling,
} from "./native-polling"
export { YsuEndpointSettingsPanel, type YsuEndpointSettingsPanelProps } from "./settings-panel"
export { getYSUMfaMethods, isYSUMfaMethod, type YSUMfaMethod } from "./types"
export {
  YSU_CONFIG,
  YSU_SECURE_KEY_CAS_TGC,
  YSU_SESSION_ARTIFACT_JWXT,
  YSU_SESSION_ARTIFACT_MOBILE,
  type YSUConfig,
} from "./ysu-config"
export { createYsuSchoolProvider, type YsuSchoolProvider } from "./ysu-provider"
