"use client"

import { useCallback } from "react"
import { useI18n } from "@/plugins/official/runtime/i18n/context"

export function usePluginTranslation(pluginId: string) {
  const { locale, translatePlugin } = useI18n()
  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translatePlugin(pluginId, key, params),
    [translatePlugin, pluginId]
  )
  return { t, locale, translate: translatePlugin }
}
