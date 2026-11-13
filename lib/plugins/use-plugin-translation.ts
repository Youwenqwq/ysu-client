"use client"

import { useCallback, useSyncExternalStore } from "react"
import { usePluginHost } from "@/components/plugin-context"
import { useI18n } from "@/lib/i18n/context"

export function usePluginTranslation(pluginId: string) {
  const { host } = usePluginHost()
  const { locale } = useI18n()
  useSyncExternalStore(host.i18n.subscribe, host.i18n.getSnapshot, host.i18n.getSnapshot)
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      host.i18n.translate(pluginId, key, locale, params),
    [host, locale, pluginId]
  )
  return { t, locale }
}
