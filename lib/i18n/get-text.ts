import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "../storage/keys"
import { zh, en } from "./dict"
import { translateDictionary } from "./translate"

const STORAGE_KEY = STORAGE_KEYS.locale
const LEGACY_STORAGE_KEY = STORAGE_KEYS.legacyLocale

export function getText(key: string): string {
  if (typeof window === "undefined") return key
  const locale =
    getLocalStorageItemWithFallback(STORAGE_KEY, LEGACY_STORAGE_KEY) === "en" ? "en" : "zh"
  const dict = locale === "en" ? en : zh

  return translateDictionary(dict as Record<string, unknown>, key)
}
