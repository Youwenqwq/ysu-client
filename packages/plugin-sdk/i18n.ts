export type PluginLocale = "zh" | "en"
export type PluginDictionary = Record<string, unknown>
export type PluginTranslations = Partial<Record<PluginLocale, PluginDictionary>>

export interface PluginI18nService {
  register(translations: PluginTranslations): () => void
  t(key: string, params?: Record<string, string | number>, locale?: PluginLocale): string
}
