import { STORAGE_KEYS } from "../storage/keys"
import { zh, en } from "./dict"
import { translateDictionary } from "./translate"

const STORAGE_KEY = STORAGE_KEYS.locale

export function getText(key: string): string {
  if (typeof window === "undefined") return key
  const locale = localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh"
  const dict = locale === "en" ? en : zh

  return translateDictionary(dict as Record<string, unknown>, key)
}
