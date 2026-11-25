import type { ObservableSource } from "./observable"

export type PluginLocale = "zh" | "en"

export interface DictionaryMessages {
  readonly [key: string]: string | DictionaryMessages
}

export type ShapeOfDictionary<T> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends DictionaryMessages
      ? ShapeOfDictionary<T[K]>
      : never
}

export interface DefinedDictionary<T extends DictionaryMessages = DictionaryMessages> {
  readonly zh: T
  readonly en: ShapeOfDictionary<T>
}

type IsIndexSignature<T> = string extends keyof T ? true : false

export type DotPathKeys<T, Prefix extends string = ""> =
  IsIndexSignature<T> extends true
    ? string
    : {
        [K in Extract<keyof T, string>]: T[K] extends string
          ? `${Prefix}${K}`
          : T[K] extends DictionaryMessages
            ? DotPathKeys<T[K], `${Prefix}${K}.`>
            : never
      }[Extract<keyof T, string>]

export type TranslationKeyOf<D> = [D] extends [never]
  ? string
  : D extends DefinedDictionary<infer T>
    ? DotPathKeys<T>
    : D extends DictionaryMessages
      ? DotPathKeys<D>
      : string

export type Translator<D = undefined> = (
  key: TranslationKeyOf<D>,
  params?: Readonly<Record<string, string | number>>
) => string

/**
 * Defines a bilingual plugin dictionary whose dot-path keys are statically
 * checked across `zh` and `en` and narrowed in component `t(...)` props.
 */
export function defineDictionary<const T extends DictionaryMessages>(input: {
  readonly zh: T
  readonly en: ShapeOfDictionary<T>
}): DefinedDictionary<T> {
  return input
}

function isNestedMessages(value: unknown): value is DictionaryMessages {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function resolveDictionaryMessage(
  messages: DictionaryMessages,
  key: string,
  params?: Readonly<Record<string, string | number>>
): string | undefined {
  let cursor: string | DictionaryMessages | undefined = messages
  for (const segment of key.split(".")) {
    if (!isNestedMessages(cursor)) return undefined
    cursor = cursor[segment]
  }
  if (typeof cursor !== "string") return undefined
  if (!params) return cursor
  return cursor.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

export function createTranslator<D extends DefinedDictionary>(
  dictionary: D,
  getLocale: () => PluginLocale
): Translator<D> {
  return (key, params) => {
    const locale = getLocale()
    const primary = locale === "en" ? dictionary.en : dictionary.zh
    const fallback = locale === "en" ? dictionary.zh : dictionary.en
    return (
      resolveDictionaryMessage(primary, key, params) ??
      resolveDictionaryMessage(fallback, key, params) ??
      key
    )
  }
}

export type PluginDictionary = Record<string, unknown>
export type PluginTranslations = Partial<Record<PluginLocale, PluginDictionary>>

export interface PluginI18nService {
  readonly locale: ObservableSource<PluginLocale>
  register(translations: PluginTranslations): () => void
  t(key: string, params?: Record<string, string | number>, locale?: PluginLocale): string
  translator<D extends DefinedDictionary>(dictionary: D): Translator<D>
  getLocale(): PluginLocale
  setLocale(locale: PluginLocale): void
  /** Read-only cross-plugin resolution, e.g. overview widget dictionaries. */
  translate(
    pluginId: string,
    key: string,
    locale: PluginLocale,
    params?: Record<string, string | number>
  ): string
  /** Read-only merged dictionary snapshot for the requested locale. */
  getDictionary<T extends PluginDictionary>(locale: PluginLocale, base: T): T
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
