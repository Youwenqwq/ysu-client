import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  createTranslator,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type DefinedDictionary,
  type ObservableSource,
  type PluginDictionary,
  type PluginI18nRegistryService,
  type PluginI18nService,
  type PluginKeyValueStorage,
  type PluginLocale,
  type PluginManifest,
  type PluginTranslations,
  type ScopedPluginService,
  type Translator,
} from "@orahako/sdk"

export const I18N_RUNTIME_PLUGIN_ID = "orahako.runtime.i18n"
export const I18N_PLUGIN_STORAGE_KEY = "locale"
export const I18N_SCOPED_STORAGE_KEY = `orahako-plugin:${I18N_RUNTIME_PLUGIN_ID}:${I18N_PLUGIN_STORAGE_KEY}`

export interface PluginI18nRegistryOptions {
  readonly defaultLocale?: PluginLocale
  readonly storage?: PluginKeyValueStorage
  readonly baseTranslations?: PluginTranslations
}

function isPluginLocale(value: unknown): value is PluginLocale {
  return value === "zh" || value === "en"
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneRecord<T extends Record<string, unknown>>(source: T): T {
  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    copy[key] = isPlainRecord(value)
      ? cloneRecord(value)
      : Array.isArray(value)
        ? [...value]
        : value
  }
  return copy as T
}

function mergeDictionary(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (isPlainRecord(current) && isPlainRecord(value)) {
      mergeDictionary(current, value)
    } else if (isPlainRecord(value)) {
      target[key] = cloneRecord(value)
    } else {
      target[key] = value
    }
  }
}

function lookupTranslation(
  dictionary: PluginDictionary | undefined,
  key: string,
  params?: Record<string, string | number>
): string | undefined {
  if (!dictionary) return undefined
  let cursor: unknown = dictionary
  for (const part of key.split(".")) {
    if (!isPlainRecord(cursor)) return undefined
    cursor = cursor[part]
  }
  if (typeof cursor !== "string") return undefined
  if (!params) return cursor
  return cursor.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

function readLocalStorageLocale(): PluginLocale | undefined {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(I18N_SCOPED_STORAGE_KEY)
      if (isPluginLocale(stored)) return stored
    }
  } catch {
    // Ignore unavailable Web storage in restricted environments.
  }
  return undefined
}

function writeLocalStorageLocale(locale: PluginLocale): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(I18N_SCOPED_STORAGE_KEY, locale)
    }
  } catch {
    // In-memory observable state remains authoritative when Web storage fails.
  }
}

export class PluginI18nRegistry
  implements PluginI18nRegistryService, ScopedPluginService<PluginI18nService>
{
  readonly locale: ObservableSource<PluginLocale>
  private readonly localeSource: ReturnType<typeof createObservableSource<PluginLocale>>
  private readonly revisionSource = createObservableSource<number>(0)
  private readonly translations = new Map<string, PluginTranslations[]>()
  private readonly baseTranslations?: PluginTranslations
  private storage?: PluginKeyValueStorage
  private mutatedBeforeHydration = false
  private disposed = false

  constructor(options: PluginI18nRegistryOptions = {}) {
    const initialLocale =
      (options.storage === undefined ? readLocalStorageLocale() : undefined) ??
      options.defaultLocale ??
      "zh"
    this.localeSource = createObservableSource<PluginLocale>(initialLocale)
    this.locale = {
      getSnapshot: this.localeSource.getSnapshot,
      subscribe: this.localeSource.subscribe,
    }
    this.baseTranslations = options.baseTranslations
    if (options.storage) {
      this.attachStorage(options.storage)
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginI18nService {
    return {
      locale: this.locale,
      register: (translations) =>
        trackPluginRegistration(ctx, () => this.registerForPlugin(manifest.id, translations)),
      t: (key, params, targetLocale) =>
        this.translate(manifest.id, key, targetLocale ?? this.getLocale(), params),
      translator: <D extends DefinedDictionary>(dictionary: D): Translator<D> =>
        createTranslator(dictionary, this.getLocale),
      getLocale: this.getLocale,
      setLocale: this.setLocale,
    }
  }

  attachStorage(storage: PluginKeyValueStorage): void {
    if (this.disposed || this.storage === storage) return
    this.storage = storage
    if (this.mutatedBeforeHydration) {
      void storage.setItem(I18N_PLUGIN_STORAGE_KEY, this.getLocale()).catch(() => {})
      return
    }
    void storage
      .getItem(I18N_PLUGIN_STORAGE_KEY)
      .then((raw) => {
        if (this.disposed || this.mutatedBeforeHydration || !isPluginLocale(raw)) return
        if (this.localeSource.getSnapshot() !== raw) {
          this.localeSource.set(raw)
          this.bumpRevision()
        }
      })
      .catch(() => {})
  }

  register = (translations: PluginTranslations): (() => void) => {
    return this.registerForPlugin("", translations)
  }

  t = (
    key: string,
    params?: Record<string, string | number>,
    targetLocale?: PluginLocale
  ): string => {
    return this.translate("", key, targetLocale ?? this.getLocale(), params)
  }

  translator = <D extends DefinedDictionary>(dictionary: D): Translator<D> => {
    return createTranslator(dictionary, this.getLocale)
  }

  getLocale = (): PluginLocale => {
    return this.localeSource.getSnapshot()
  }

  setLocale = (next: PluginLocale): void => {
    if (!isPluginLocale(next)) {
      throw new Error(`Unsupported plugin locale: ${String(next)}`)
    }
    this.mutatedBeforeHydration = true
    if (this.storage) {
      void this.storage.setItem(I18N_PLUGIN_STORAGE_KEY, next).catch(() => {})
    } else {
      writeLocalStorageLocale(next)
    }
    if (this.localeSource.getSnapshot() === next) return
    this.localeSource.set(next)
    this.bumpRevision()
  }

  getSnapshot = (): number => {
    return this.revisionSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.revisionSource.subscribe(listener)
  }

  translate = (
    pluginId: string,
    key: string,
    locale: PluginLocale,
    params?: Record<string, string | number>
  ): string => {
    const fallbackLocale: PluginLocale = locale === "en" ? "zh" : "en"

    const fromPluginPrimary = this.lookupPluginEntries(pluginId, locale, key, params)
    if (fromPluginPrimary !== undefined) return fromPluginPrimary

    if (pluginId !== "") {
      const fromSharedPrimary = this.lookupPluginEntries("", locale, key, params)
      if (fromSharedPrimary !== undefined) return fromSharedPrimary
    }

    const fromBasePrimary = lookupTranslation(this.baseTranslations?.[locale], key, params)
    if (fromBasePrimary !== undefined) return fromBasePrimary

    const fromPluginFallback = this.lookupPluginEntries(pluginId, fallbackLocale, key, params)
    if (fromPluginFallback !== undefined) return fromPluginFallback

    if (pluginId !== "") {
      const fromSharedFallback = this.lookupPluginEntries("", fallbackLocale, key, params)
      if (fromSharedFallback !== undefined) return fromSharedFallback
    }

    const fromBaseFallback = lookupTranslation(this.baseTranslations?.[fallbackLocale], key, params)
    if (fromBaseFallback !== undefined) return fromBaseFallback

    return key
  }

  getDictionary<T extends PluginDictionary>(locale: PluginLocale, base: T): T {
    const result = cloneRecord(base)
    if (this.baseTranslations?.[locale]) {
      mergeDictionary(result, this.baseTranslations[locale])
    }
    for (const list of this.translations.values()) {
      for (const entry of list) {
        const dictionary = entry[locale]
        if (dictionary) {
          mergeDictionary(result, dictionary)
        }
      }
    }
    return result
  }

  dispose(): void {
    this.disposed = true
  }

  private registerForPlugin(pluginId: string, translations: PluginTranslations): () => void {
    const existing = this.translations.get(pluginId)
    if (existing) {
      existing.push(translations)
    } else {
      this.translations.set(pluginId, [translations])
    }
    this.bumpRevision()

    let removed = false
    return () => {
      if (removed) return
      removed = true
      const current = this.translations.get(pluginId)
      if (!current) return
      const index = current.lastIndexOf(translations)
      if (index >= 0) {
        current.splice(index, 1)
      }
      if (current.length === 0) {
        this.translations.delete(pluginId)
      }
      this.bumpRevision()
    }
  }

  private lookupPluginEntries(
    pluginId: string,
    locale: PluginLocale,
    key: string,
    params?: Record<string, string | number>
  ): string | undefined {
    const entries = this.translations.get(pluginId)
    if (!entries) return undefined
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const found = lookupTranslation(entries[index]?.[locale], key, params)
      if (found !== undefined) return found
    }
    return undefined
  }

  private bumpRevision(): void {
    this.revisionSource.set((value) => value + 1)
  }
}
