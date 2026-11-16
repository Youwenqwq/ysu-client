"use client"

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { STORAGE_KEYS } from "@/plugins/official/runtime/storage/keys"
import { zh, en } from "./dict"
import type { PluginI18nRegistryService } from "@orahako/plugin-sdk"
import type { Locale, Dictionary } from "./dict"

const dictionaries: Record<Locale, Dictionary> = { zh, en }

interface I18nContextValue {
  locale: Locale
  dict: Dictionary
  setLocale: (locale: Locale) => void
  translatePlugin(
    pluginId: string,
    key: string,
    params?: Record<string, string | number>
  ): string
}

const I18nContext = createContext<I18nContextValue>({
  locale: "zh",
  dict: zh,
  setLocale: () => {},
  translatePlugin: (_pluginId, key) => key,
})

const STORAGE_KEY = STORAGE_KEYS.locale
const MANUAL_KEY = STORAGE_KEYS.localeManual

function resolveLocale(raw: string): Locale {
  return raw.toLowerCase().startsWith("zh") ? "zh" : "en"
}

function detectSystemLocale(): Locale {
  if (typeof navigator !== "undefined" && navigator.language) {
    return resolveLocale(navigator.language)
  }
  return "zh"
}

export function I18nProvider({
  registry,
  children,
}: {
  registry: PluginI18nRegistryService
  children: ReactNode
}) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === "undefined") return "zh"
    if (localStorage.getItem(MANUAL_KEY)) {
      return (localStorage.getItem(STORAGE_KEY) as Locale) || "zh"
    }
    return detectSystemLocale()
  })

  // On mount: if no manual override, detect system language via Capacitor
  // and fall back to browser navigator.language
  useEffect(() => {
    if (typeof window === "undefined") return
    if (localStorage.getItem(MANUAL_KEY)) return

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
    }
  }, [])

  useEffect(() => {
    registry.setLocale(locale)
  }, [registry, locale])

  const pluginDictVersion = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot
  )
  const dict = useMemo(() => {
    void pluginDictVersion
    return registry.getDictionary(locale, dictionaries[locale])
  }, [registry, locale, pluginDictVersion])

  const translatePlugin = useCallback(
    (pluginId: string, key: string, params?: Record<string, string | number>) =>
      registry.translate(pluginId, key, locale, params),
    [registry, locale]
  )

  return (
    <I18nContext.Provider value={{ locale, dict, setLocale, translatePlugin }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
