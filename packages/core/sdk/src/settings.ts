import type { Context } from "@cordisjs/core"
import type { ObservableSource } from "./observable"
import type { ChildrenSpec, DerivedComponentProps, SlotComponent, ValidInject } from "./slots"
import type { PluginIcon } from "./ui"

export interface SettingsCategorySpec<
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> {
  /** Globally unique category id; also used as the detail page key. */
  readonly id: string
  readonly title?: string
  readonly titleKey?: string
  readonly description?: string
  readonly descriptionKey?: string
  readonly icon: PluginIcon
  /** Ascending position in the category list. Defaults to 100. */
  readonly order?: number
  readonly dictionary?: Dict
  readonly children?: Children
  readonly store?: Store
  /** Returns renderer data from the `apply` closure; no Context escapes. */
  readonly inject?: () => ValidInject<I>
}

export interface PluginSettingsCategory {
  readonly id: string
  readonly pluginId: string
  readonly title?: string
  readonly titleKey?: string
  readonly description?: string
  readonly descriptionKey?: string
  readonly icon: PluginIcon
  readonly order?: number
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
}

export interface PluginSettingsService {
  readonly state: ObservableSource<readonly PluginSettingsCategory[]>
  getSnapshot(): readonly PluginSettingsCategory[]
  subscribe(listener: () => void): () => void
  registerCategory<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SettingsCategorySpec<Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void
  registerCategory<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SettingsCategorySpec<Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    }
  ): () => void
}
