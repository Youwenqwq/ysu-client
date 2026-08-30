"use client"

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react"
import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "../storage/keys"
import { zh, en } from "./dict"
import type { Locale, Dictionary } from "./dict"

const dictionaries: Record<Locale, Dictionary> = { zh, en }

interface I18nContextValue {
  locale: Locale
  dict: Dictionary
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh",
  dict: zh,
  setLocale: () => {},
})

const STORAGE_KEY = STORAGE_KEYS.locale
const LEGACY_STORAGE_KEY = STORAGE_KEYS.legacyLocale
const MANUAL_KEY = STORAGE_KEYS.localeManual
const LEGACY_MANUAL_KEY = STORAGE_KEYS.legacyLocaleManual

function resolveLocale(raw: string): Locale {
  return raw.toLowerCase().startsWith("zh") ? "zh" : "en"
}

function detectSystemLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language) {
    return resolveLocale(navigator.language)
  }
  return "zh"
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh"
    if (getLocalStorageItemWithFallback(MANUAL_KEY, LEGACY_MANUAL_KEY)) {
      return (getLocalStorageItemWithFallback(STORAGE_KEY, LEGACY_STORAGE_KEY) as Locale) || "zh"
    }
    return detectSystemLocale()
  })

  // On mount: if no manual override, detect system language via Capacitor
  // and fall back to browser navigator.language
  useEffect(() => {
    if (typeof window === "undefined") return
    if (getLocalStorageItemWithFallback(MANUAL_KEY, LEGACY_MANUAL_KEY)) return

    let cancelled = false

    ;(async () => {
      let detected: Locale
      try {
        const { Device } = await import("@capacitor/device")
        const { value } = await Device.getLanguageCode()
        detected = resolveLocale(value)
      } catch {
        detected = detectSystemLocale()
      }
      if (!cancelled) {
        setLocaleState(detected)
        localStorage.setItem(STORAGE_KEY, detected)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l)
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, l)
      localStorage.setItem(MANUAL_KEY, "1")
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      localStorage.removeItem(LEGACY_MANUAL_KEY)
    }
  }, [])

  const dict = dictionaries[locale]

  return <I18nContext.Provider value={{ locale, dict, setLocale }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
