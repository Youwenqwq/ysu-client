import { useSettingsStore } from "@/lib/stores/settings"

export function normalizeCustomUserAgent(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

export function getCustomUserAgent(): string {
  const state = useSettingsStore.getState()
  if (!state.customUserAgentEnabled) {
    return typeof navigator !== "undefined" ? navigator.userAgent : ""
  }
  const custom = normalizeCustomUserAgent(state.customUserAgent)
  return custom || (typeof navigator !== "undefined" ? navigator.userAgent : "")
}
