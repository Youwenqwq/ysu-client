import type { PluginI18nService, PluginLocale, PluginTranslations } from "@orahako/plugin-sdk"
import { en, zh, type Dictionary } from "@/lib/i18n/dict"
import { translateDictionary } from "@/lib/i18n/translate"
import type { PluginServiceFactory } from "./runtime"
import { trackPluginRegistration } from "./track-registration"

function mergeDictionary(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      mergeDictionary(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

export class PluginI18nRegistry {
  private readonly translations = new Map<string, PluginTranslations>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  createService: PluginServiceFactory = (ctx, manifest) => {
    const service: PluginI18nService = {
      register: (translations) =>
        trackPluginRegistration(ctx, () => {
          this.translations.set(manifest.id, translations)
          this.publish()
          return () => {
            if (this.translations.get(manifest.id) !== translations) return
            this.translations.delete(manifest.id)
            this.publish()
          }
        }),
      t: (key, params, locale) => this.translate(manifest.id, key, locale ?? "zh", params),
    }
    ctx.set("i18n", service)
  }

  translate(
    pluginId: string,
    key: string,
    locale: PluginLocale,
    params?: Record<string, string | number>
  ): string {
    const pluginDictionary = this.translations.get(pluginId)?.[locale]
    if (pluginDictionary) {
      const translated = translateDictionary(pluginDictionary, key, params)
      if (translated !== key) return translated
    }
    return translateDictionary((locale === "en" ? en : zh) as Record<string, unknown>, key, params)
  }

  getSnapshot = (): number => this.version

  getDictionary(locale: PluginLocale, base: Dictionary): Dictionary {
    const result = structuredClone(base)
    for (const translations of this.translations.values()) {
      const dictionary = translations[locale]
      if (dictionary) {
        mergeDictionary(result as Record<string, unknown>, dictionary as Record<string, unknown>)
      }
    }
    return result
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

export const pluginI18nRegistry = new PluginI18nRegistry()
