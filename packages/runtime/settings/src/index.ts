import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  declareContributionChildren,
  definePlugin,
  isScopedPluginService,
  isStoreDefinition,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  resolvePluginStorage,
  trackPluginRegistration,
  type ChildrenSpec,
  type DerivedComponentProps,
  type ObservableSource,
  type PluginManifest,
  type PluginSettingsCategory,
  type PluginSettingsService,
  type PluginSlotService,
  type ScopedPluginService,
  type SettingsCategorySpec,
  type SlotComponent,
  type StoreInstance,
} from "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.category.panel": { kind: "keyed"; owner: Record<string, never> }
  }
}

const DEFAULT_CATEGORY_ORDER = 100
export const SETTINGS_RUNTIME_PLUGIN_ID = "orahako.runtime.settings"

function isPluginSlotService(value: unknown): value is PluginSlotService {
  return (
    typeof value === "object" &&
    value !== null &&
    "register" in value &&
    typeof value.register === "function" &&
    "inject" in value &&
    typeof value.inject === "function"
  )
}

function resolveRegistrantSlots(
  ctx: Context,
  manifest: PluginManifest
): PluginSlotService | undefined {
  const raw: unknown = ctx.get("slots") ?? ctx.root.get("slots")
  if (!raw) return undefined
  if (isScopedPluginService(raw)) {
    const scoped = raw[PLUGIN_SERVICE_SCOPE](ctx, manifest)
    return isPluginSlotService(scoped) ? scoped : undefined
  }
  return isPluginSlotService(raw) ? raw : undefined
}

export class PluginSettingsRegistry
  implements PluginSettingsService, ScopedPluginService<PluginSettingsService>
{
  readonly state: ObservableSource<readonly PluginSettingsCategory[]>
  private readonly stateSource = createObservableSource<readonly PluginSettingsCategory[]>([])
  private readonly categories = new Map<string, PluginSettingsCategory>()

  constructor() {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginSettingsService {
    const registerScoped = <
      Dict = undefined,
      const Children extends ChildrenSpec | undefined = undefined,
      Store = undefined,
      I = undefined,
    >(
      spec: SettingsCategorySpec<Dict, Children, Store, I> & {
        readonly component?: SlotComponent<
          NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
        >
      },
      maybeComponent?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    ): (() => void) =>
      trackPluginRegistration(ctx, () => this.registerInternal(manifest, ctx, spec, maybeComponent))

    return {
      state: this.state,
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      registerCategory: registerScoped as PluginSettingsService["registerCategory"],
    }
  }

  getSnapshot = (): readonly PluginSettingsCategory[] => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

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
  registerCategory<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SettingsCategorySpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void {
    return this.registerInternal(undefined, undefined, spec, maybeComponent)
  }

  private registerInternal<
    Dict = undefined,
    Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    manifest: PluginManifest | undefined,
    registrantCtx: Context | undefined,
    spec: SettingsCategorySpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void {
    if (!spec.id) {
      throw new Error("Plugin settings category id must not be empty")
    }
    const resolvedComponent = maybeComponent ?? spec.component
    if (typeof resolvedComponent !== "function") {
      throw new Error(`Plugin settings category requires a component: ${spec.id}`)
    }
    const existing = this.categories.get(spec.id)
    if (existing) {
      throw new Error(
        `Plugin settings category already registered: ${spec.id} (${existing.pluginId})`
      )
    }

    const pluginId = manifest?.id ?? ""
    let disposed = false
    let panelMounted = false
    let disposeStandaloneChildren: (() => void) | undefined
    let disposeSlotInject: (() => void) | undefined
    let stopSlotsServiceListener: (() => void) | undefined

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      const storage =
        registrantCtx && manifest ? resolvePluginStorage(registrantCtx, manifest) : undefined
      ownedStore = spec.store.create(storage)
      resolvedStore = ownedStore
    }

    const boundInject: ((ctx: Context) => unknown) | undefined = spec.inject
      ? (fallbackCtx: Context) => spec.inject!(registrantCtx ?? fallbackCtx)
      : undefined

    const releaseStandaloneChildren = (): void => {
      const release = disposeStandaloneChildren
      disposeStandaloneChildren = undefined
      release?.()
    }

    const attachSlotBridge = (slots: PluginSlotService): void => {
      disposeSlotInject = slots.inject("settings.category.panel", () => {
        releaseStandaloneChildren()
        panelMounted = true
        const disposePanel = slots.register<"settings.category.panel", Dict, Children, Store, I>(
          {
            id: `category-${spec.id}`,
            slot: "settings.category.panel",
            key: spec.id,
            ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
            ...(spec.children !== undefined ? { children: spec.children } : {}),
            ...(resolvedStore !== undefined ? { store: resolvedStore as Store } : {}),
            ...(boundInject !== undefined ? { inject: boundInject as typeof spec.inject } : {}),
          },
          resolvedComponent
        )
        return () => {
          panelMounted = false
          disposePanel()
          if (!disposed && spec.children && !disposeStandaloneChildren) {
            disposeStandaloneChildren = declareContributionChildren(registrantCtx, spec.children)
          }
        }
      })
    }

    try {
      if (registrantCtx && manifest) {
        const initialSlots = resolveRegistrantSlots(registrantCtx, manifest)
        if (initialSlots) {
          attachSlotBridge(initialSlots)
        } else {
          stopSlotsServiceListener = registrantCtx.on("internal/service", (serviceName: string) => {
            if (disposed || serviceName !== "slots" || disposeSlotInject) return
            const lateSlots = resolveRegistrantSlots(registrantCtx, manifest)
            if (lateSlots) {
              attachSlotBridge(lateSlots)
            }
          })
        }
      }

      if (!panelMounted) {
        disposeStandaloneChildren = declareContributionChildren(registrantCtx, spec.children)
      }
    } catch (error) {
      disposed = true
      stopSlotsServiceListener?.()
      disposeSlotInject?.()
      releaseStandaloneChildren()
      ownedStore?.dispose()
      ownedStore = undefined
      throw error
    }

    const registered: PluginSettingsCategory = {
      id: spec.id,
      pluginId,
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      ...(spec.titleKey !== undefined ? { titleKey: spec.titleKey } : {}),
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      ...(spec.descriptionKey !== undefined ? { descriptionKey: spec.descriptionKey } : {}),
      icon: spec.icon,
      ...(spec.order !== undefined ? { order: spec.order } : {}),
      ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
      ...(spec.children !== undefined ? { children: spec.children } : {}),
      ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
      ...(boundInject !== undefined ? { inject: boundInject } : {}),
      component: resolvedComponent as SlotComponent<never>,
    }

    this.categories.set(spec.id, registered)
    this.publish()

    return () => {
      if (disposed) return
      disposed = true
      if (this.categories.get(spec.id) === registered) {
        this.categories.delete(spec.id)
        this.publish()
      }
      stopSlotsServiceListener?.()
      stopSlotsServiceListener = undefined
      disposeSlotInject?.()
      disposeSlotInject = undefined
      releaseStandaloneChildren()
      ownedStore?.dispose()
      ownedStore = undefined
    }
  }

  private publish(): void {
    const next = Array.from(this.categories.values()).sort(
      (a, b) =>
        (a.order ?? DEFAULT_CATEGORY_ORDER) - (b.order ?? DEFAULT_CATEGORY_ORDER) ||
        a.id.localeCompare(b.id)
    )
    this.stateSource.set(next)
  }
}

export const settingsRegistryPlugin = definePlugin({
  manifest: {
    id: SETTINGS_RUNTIME_PLUGIN_ID,
    name: "设置注册表",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "插件设置分类的根注册表",
    provides: ["settings"],
  },
  apply(ctx) {
    ctx.set("settings", new PluginSettingsRegistry())
  },
})
