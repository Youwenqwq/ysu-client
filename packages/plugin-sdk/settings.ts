import type { ComponentType } from "react"

/**
 * A settings category contributed by a plugin. The host lists every category
 * in one plugin-settings screen and renders the matching component on the
 * category detail page.
 */
export interface PluginSettingsCategoryContribution {
  /** Globally unique category id; also used as the detail page key. */
  id: string
  title: string
  titleKey?: string
  description: string
  descriptionKey?: string
  icon: ComponentType<{ className?: string }>
  component: ComponentType
  /** Ascending position in the category list. Defaults to 100. */
  order?: number
}

export interface PluginSettingsCategory extends PluginSettingsCategoryContribution {
  pluginId: string
}

export interface PluginSettingsService {
  /** Registers a category for the current plugin; the returned token unregisters it. */
  registerCategory(category: PluginSettingsCategoryContribution): () => void
  getSnapshot(): readonly PluginSettingsCategory[]
  subscribe(listener: () => void): () => void
}
