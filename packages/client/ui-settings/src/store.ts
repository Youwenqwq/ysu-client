import { defineStore, type HttpRequest } from "@orahako/sdk"

export interface SettingsStoreState {
  readonly customUserAgentEnabled: boolean
  readonly customUserAgent: string
}

export function normalizeCustomUserAgent(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function resolveEffectiveUserAgent(
  state: Pick<SettingsStoreState, "customUserAgentEnabled" | "customUserAgent">,
  defaultUserAgent = ""
): string {
  if (!state.customUserAgentEnabled) {
    return defaultUserAgent
  }
  const normalized = normalizeCustomUserAgent(state.customUserAgent)
  return normalized || defaultUserAgent
}

export function applyCustomUserAgentHeader(
  request: HttpRequest,
  state: Pick<SettingsStoreState, "customUserAgentEnabled" | "customUserAgent">
): HttpRequest {
  if (!state.customUserAgentEnabled) {
    return request
  }
  const normalized = normalizeCustomUserAgent(state.customUserAgent)
  if (!normalized) {
    return request
  }
  const nextHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (key.toLowerCase() === "user-agent") continue
    nextHeaders[key] = value
  }
  nextHeaders["User-Agent"] = normalized
  return {
    ...request,
    headers: nextHeaders,
  }
}

export const settingsStore = defineStore({
  init: (): SettingsStoreState => ({
    customUserAgentEnabled: false,
    customUserAgent: "",
  }),
  persist: {
    key: "preferences",
    mode: "local",
    version: 1,
  },
  actions: {
    setCustomUserAgentEnabled(ctx, enabled: boolean) {
      ctx.set((prev) => ({ ...prev, customUserAgentEnabled: enabled }))
    },
    setCustomUserAgent(ctx, value: string) {
      ctx.set((prev) => ({ ...prev, customUserAgent: normalizeCustomUserAgent(value) }))
    },
    resetCustomUserAgent(ctx) {
      ctx.set((prev) => ({ ...prev, customUserAgentEnabled: false, customUserAgent: "" }))
    },
  },
})

export type SettingsStoreDefinition = typeof settingsStore
export type SettingsStoreInstance = ReturnType<typeof settingsStore.create>
