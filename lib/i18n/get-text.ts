import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "../storage/keys"
import { zh, en } from "./dict"

const STORAGE_KEY = STORAGE_KEYS.locale
const LEGACY_STORAGE_KEY = STORAGE_KEYS.legacyLocale

export function getText(key: string): string {
  if (typeof window === "undefined") return key
  const locale =
    getLocalStorageItemWithFallback(STORAGE_KEY, LEGACY_STORAGE_KEY) === "en" ? "en" : "zh"
  const dict = locale === "en" ? en : zh

  const keys = key.split(".")
  let current: unknown = dict
  for (const k of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return key
    }
    current = (current as Record<string, unknown>)[k]
  }
  if (typeof current === "string") return current
  return key
}
