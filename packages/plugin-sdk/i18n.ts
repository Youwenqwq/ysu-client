export type PluginLocale = "zh" | "en"
export type PluginDictionary = Record<string, unknown>
export type PluginTranslations = Partial<Record<PluginLocale, PluginDictionary>>

export interface PluginI18nService {
  register(translations: PluginTranslations): () => void
  t(key: string, params?: Record<string, string | number>, locale?: PluginLocale): string
  getLocale(): PluginLocale
  setLocale(locale: PluginLocale): void
}

export interface PluginI18nRegistryService extends PluginI18nService {
  getSnapshot(): number
  subscribe(listener: () => void): () => void
  translate(
    pluginId: string,
    key: string,
    locale: PluginLocale,
    params?: Record<string, string | number>
  ): string
  getDictionary<T extends PluginDictionary>(locale: PluginLocale, base: T): T
}
