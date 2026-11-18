import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  definePlugin,
  isScopedPluginService,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type ChildrenSpec,
  type DerivedComponentProps,
  type ObservableSource,
  type PluginManifest,
  type PluginSettingsCategory,
  type PluginSettingsService,
  type PluginSlotDeclaration,
  type PluginSlotRegistryService,
  type PluginStorageService,
  type ScopedPluginService,
  type SettingsCategorySpec,
  type SlotComponent,
  type SlotName,
  type StoreDefinition,
  type StoreInstance,
} from "@orahako/sdk"

const DEFAULT_CATEGORY_ORDER = 100
export const SETTINGS_RUNTIME_PLUGIN_ID = "orahako.runtime.settings"

function isPluginStorageService(value: unknown): value is PluginStorageService {
  return typeof value === "object" && value !== null && "local" in value && "secure" in value
}

function resolveRegistrantStorage(
  ctx: Context,
  manifest: PluginManifest
): PluginStorageService | undefined {
  const raw: unknown = ctx.get("storage")
  if (!raw) return undefined
  if (isScopedPluginService(raw)) {
    const scoped = raw[PLUGIN_SERVICE_SCOPE](ctx, manifest)
    return isPluginStorageService(scoped) ? scoped : undefined
  }
  return isPluginStorageService(raw) ? raw : undefined
}

function isStoreDefinition(
  value: unknown
): value is StoreDefinition<unknown, Record<string, never>> {
  return (
    typeof value === "object" &&
    value !== null &&
    "create" in value &&
    typeof value.create === "function"
  )
}

function isSlotRegistryService(value: unknown): value is PluginSlotRegistryService {
  return (
    typeof value === "object" &&
    value !== null &&
    "declare" in value &&
    typeof value.declare === "function"
  )
}

function declareContributionChildren(
  ctx: Context | undefined,
  children: ChildrenSpec | undefined
): () => void {
  if (!ctx || !children) return () => {}
  const entries: PluginSlotDeclaration[] = []
  for (const [name, spec] of Object.entries(children)) {
    if (spec) {
      entries.push({ name: name as SlotName, kind: spec.kind })
    }
  }
  if (entries.length === 0) return () => {}

  let disposed = false
  let childDisposers: Array<() => void> = []
  let stopServiceListener: (() => void) | undefined

  const applyDeclarations = (slots: PluginSlotRegistryService): void => {
    const created: Array<() => void> = []
    try {
      for (const entry of entries) {
        created.push(slots.declare(entry))
      }
      childDisposers = created
    } catch (error) {
      for (let i = created.length - 1; i >= 0; i -= 1) {
        created[i]?.()
      }
      throw error
    }
  }

  const rootSlots: unknown = ctx.root.get("slots")
  if (isSlotRegistryService(rootSlots)) {
    applyDeclarations(rootSlots)
  } else {
    stopServiceListener = ctx.on("internal/service", (serviceName: string) => {
      if (disposed || serviceName !== "slots" || childDisposers.length > 0) return
      const lateSlots: unknown = ctx.root.get("slots")
      if (isSlotRegistryService(lateSlots)) {
        applyDeclarations(lateSlots)
      }
    })
  }

  return () => {
    if (disposed) return
    disposed = true
    stopServiceListener?.()
    stopServiceListener = undefined
    const toDispose = childDisposers
    childDisposers = []
    for (let i = toDispose.length - 1; i >= 0; i -= 1) {
      toDispose[i]?.()
    }
  }
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
    const disposeChildren = declareContributionChildren(registrantCtx, spec.children)

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      try {
        const storage =
          registrantCtx && manifest ? resolveRegistrantStorage(registrantCtx, manifest) : undefined
        ownedStore = spec.store.create(storage)
        resolvedStore = ownedStore
      } catch (error) {
        disposeChildren()
        throw error
      }
    }

    const boundInject: ((ctx: Context) => unknown) | undefined = spec.inject
      ? (fallbackCtx: Context) => spec.inject!(registrantCtx ?? fallbackCtx)
      : undefined

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

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.categories.get(spec.id) === registered) {
        this.categories.delete(spec.id)
        this.publish()
      }
      disposeChildren()
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
