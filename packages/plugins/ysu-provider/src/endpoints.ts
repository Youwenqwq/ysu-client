import { defineDictionary, defineStore, type StoreInstance } from "@orahako/sdk"
import { isPlainRecord } from "./http-utils"
import { YSU_CONFIG, type YSUConfig } from "./ysu-config"

export interface YsuEndpointState {
  readonly customCerBaseUrl: string
  readonly customJwxtBaseUrl: string
}

export interface ResolvedYsuEndpoints {
  readonly cerBaseUrl: string
  readonly jwxtBaseUrl: string
}

export function normalizeEndpointBaseUrl(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? "").trim().replace(/\/+$/, "")
  return trimmed.length > 0 ? trimmed : fallback.trim().replace(/\/+$/, "")
}

export function isValidHttpBaseUrl(raw: string): boolean {
  const trimmed = raw.trim()
  if (!trimmed) return true
  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function resolveYsuEndpointUrls(
  state?: Partial<YsuEndpointState>,
  config: YSUConfig = YSU_CONFIG
): ResolvedYsuEndpoints {
  return {
    cerBaseUrl: normalizeEndpointBaseUrl(state?.customCerBaseUrl, config.cas.cerBaseUrl),
    jwxtBaseUrl: normalizeEndpointBaseUrl(state?.customJwxtBaseUrl, config.jwxt.jwxtBaseUrl),
  }
}

export const ysuEndpointStore = defineStore({
  init: (): YsuEndpointState => ({
    customCerBaseUrl: "",
    customJwxtBaseUrl: "",
  }),
  persist: {
    key: "endpoints",
    mode: "local",
    version: 1,
    migrate(persisted): YsuEndpointState {
      if (!isPlainRecord(persisted)) {
        return { customCerBaseUrl: "", customJwxtBaseUrl: "" }
      }
      return {
        customCerBaseUrl:
          typeof persisted.customCerBaseUrl === "string" ? persisted.customCerBaseUrl : "",
        customJwxtBaseUrl:
          typeof persisted.customJwxtBaseUrl === "string" ? persisted.customJwxtBaseUrl : "",
      }
    },
  },
  actions: {
    setCustomCerBaseUrl(ctx, customCerBaseUrl: string) {
      ctx.set((prev) => ({
        ...prev,
        customCerBaseUrl: customCerBaseUrl.trim().replace(/\/+$/, ""),
      }))
    },
    setCustomJwxtBaseUrl(ctx, customJwxtBaseUrl: string) {
      ctx.set((prev) => ({
        ...prev,
        customJwxtBaseUrl: customJwxtBaseUrl.trim().replace(/\/+$/, ""),
      }))
    },
    setEndpoints(ctx, next: YsuEndpointState) {
      ctx.set({
        customCerBaseUrl: next.customCerBaseUrl.trim().replace(/\/+$/, ""),
        customJwxtBaseUrl: next.customJwxtBaseUrl.trim().replace(/\/+$/, ""),
      })
    },
    resetEndpoints(ctx) {
      ctx.reset()
    },
  },
})

export type YsuEndpointStoreInstance = StoreInstance<
  YsuEndpointState,
  typeof ysuEndpointStore.spec.actions
>

export const ysuSettingsDictionary = defineDictionary({
  zh: {
    categoryTitle: "燕山大学服务节点",
    categoryDescription: "自定义统一身份认证（CAS）与教务系统（JWXT）服务器地址",
    sectionTitle: "服务器地址覆盖",
    sectionDescription:
      "留空则使用燕山大学官方默认地址；保存更改后会自动重置当前燕山大学教务会话。",
    cerLabel: "统一身份认证（CAS）",
    cerPlaceholder: "默认：{url}",
    cerHint: "当前生效：{url}",
    jwxtLabel: "教务系统（JWXT）",
    jwxtPlaceholder: "默认：{url}",
    jwxtHint: "当前生效：{url}",
    save: "保存并重连",
    reset: "恢复默认",
    savedToast: "服务节点已更新",
    resetToast: "已恢复默认服务节点",
    invalidUrlToast: "请输入有效的 http:// 或 https:// 服务器地址",
  },
  en: {
    categoryTitle: "YSU Server Endpoints",
    categoryDescription: "Override CAS authentication and JWXT academic server base URLs",
    sectionTitle: "Endpoint Overrides",
    sectionDescription:
      "Leave blank to use the official YSU endpoints. Saving changes resets the active YSU session.",
    cerLabel: "CAS Authentication Server",
    cerPlaceholder: "Default: {url}",
    cerHint: "Effective: {url}",
    jwxtLabel: "JWXT Academic Server",
    jwxtPlaceholder: "Default: {url}",
    jwxtHint: "Effective: {url}",
    save: "Save & Reconnect",
    reset: "Reset to Default",
    savedToast: "Server endpoints updated",
    resetToast: "Restored default server endpoints",
    invalidUrlToast: "Please enter a valid http:// or https:// base URL",
  },
})

export interface YsuEndpointCategoryInject {
  readonly defaultCerBaseUrl: string
  readonly defaultJwxtBaseUrl: string
  readonly onEndpointsChanged: () => Promise<void>
}
