import type { Context } from "@cordisjs/core"
import {
  PLUGIN_SERVICE_SCOPE,
  type PluginI18nService,
  type PluginDictionary,
  type PluginLocale,
  type PluginManifest,
  type PluginTranslations,
  type ScopedPluginService,
  trackPluginRegistration,
} from "@orahako/plugin-sdk"
import { en, zh } from "@/plugins/official/runtime/i18n/dict"
import { translateDictionary } from "@/plugins/official/runtime/i18n/translate"

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

export class PluginI18nRegistry implements ScopedPluginService<PluginI18nService> {
  private readonly translations = new Map<string, PluginTranslations>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private locale: PluginLocale = "zh";

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginI18nService {
    return {
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
      t: (key, params, locale) =>
        this.translate(manifest.id, key, locale ?? this.locale, params),
      getLocale: this.getLocale,
      setLocale: this.setLocale,
    }
  }

  getLocale = (): PluginLocale => this.locale

  setLocale = (locale: PluginLocale): void => {
    if (this.locale === locale) return
    this.locale = locale
    this.publish()
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

  getDictionary<T extends PluginDictionary>(locale: PluginLocale, base: T): T {
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

