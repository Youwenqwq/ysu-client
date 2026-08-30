import { useCallback } from "react"
import { useI18n } from "./context"

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".")
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return path
    }
    current = (current as Record<string, unknown>)[key]
  }
  if (typeof current === "string") return current
  return path
}

export function useTranslation() {
  const { locale, dict, setLocale } = useI18n()

  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const template = getNestedValue(dict as Record<string, unknown>, key)
      if (!params) return template
      return template.replace(/\{(\w+)\}/g, (_, k) =>
        params[k] !== undefined ? String(params[k]) : `{${k}}`
      )
    },
    [dict]
  )

  return { t, locale, setLocale }
}
