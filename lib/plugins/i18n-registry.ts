import type { PluginI18nService, PluginLocale, PluginTranslations } from "@ysu/plugin-sdk"
import { en, zh } from "@/lib/i18n/dict"
import { translateDictionary } from "@/lib/i18n/translate"
import type { PluginServiceFactory } from "./runtime"

export class PluginI18nRegistry {
  private readonly translations = new Map<string, PluginTranslations>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  createService: PluginServiceFactory = (ctx, manifest) => {
    const service: PluginI18nService = {
      register: (translations) => {
        this.translations.set(manifest.id, translations)
        this.publish()
        const dispose = () => {
          if (this.translations.get(manifest.id) !== translations) return
          this.translations.delete(manifest.id)
          this.publish()
        }
        const unregister = ctx.on("dispose", dispose)
        return () => {
          unregister()
          dispose()
        }
      },
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

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
