import {
  resolveDictionaryMessage,
  type DefinedDictionary,
  type DictionaryMessages,
  type PluginI18nService,
  type PluginLocale,
} from "@orahako/sdk"

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDictionaryMessages(value: unknown): value is DictionaryMessages {
  return isPlainRecord(value)
}

function isDefinedDictionary(value: unknown): value is DefinedDictionary {
  return isPlainRecord(value) && isDictionaryMessages(value.zh) && isDictionaryMessages(value.en)
}

export function resolveContributionText(
  dictionary: unknown,
  key: string | undefined,
  fallback: string | undefined,
  locale: PluginLocale,
  i18n: Pick<PluginI18nService, "t">
): string {
  if (key) {
    if (isDefinedDictionary(dictionary)) {
      const primary = locale === "en" ? dictionary.en : dictionary.zh
      const secondary = locale === "en" ? dictionary.zh : dictionary.en
      const resolved =
        resolveDictionaryMessage(primary, key) ?? resolveDictionaryMessage(secondary, key)
      if (resolved !== undefined) return resolved
    } else if (isDictionaryMessages(dictionary)) {
      const resolved = resolveDictionaryMessage(dictionary, key)
      if (resolved !== undefined) return resolved
    }
    const translated = i18n.t(key, undefined, locale)
    if (translated !== key) return translated
  }
  return fallback ?? key ?? ""
}
