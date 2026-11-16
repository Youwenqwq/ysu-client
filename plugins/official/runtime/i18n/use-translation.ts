import { useCallback } from "react"
import { useI18n } from "./context"
import { translateDictionary } from "./translate"

export function useTranslation() {
  const { locale, dict, setLocale } = useI18n()

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      return translateDictionary(dict as Record<string, unknown>, key, params)
    },
    [dict]
  )

  return { t, locale, setLocale }
}
