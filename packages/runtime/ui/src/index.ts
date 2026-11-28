import type { Context } from "@cordisjs/core"
import {
  assertContributionChildrenDeclared,
  createObservableSource,
  declareContributionChildren,
  definePlugin,
  isStoreDefinition,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  resolvePluginSlots,
  resolvePluginStorage,
  trackPluginRegistration,
  type ChildrenSpec,
  type DerivedComponentProps,
  type ObservableSource,
  type PageSpec,
  type PluginManifest,
  type PluginNavigationContribution,
  type PluginNavigationDefinition,
  type PluginPageContribution,
  type PluginShellContribution,
  type PluginThemeContribution,
  type PluginThemeDefinition,
  type PluginUIRegistryService,
  type PluginUIService,
  type PluginUIServiceSnapshot,
  type ScopedPluginService,
  type ShellOwnerProps,
  type ShellSpec,
  type SlotComponent,
  type StoreInstance,
} from "@orahako/sdk"

export {
  APPEARANCE_RUNTIME_PLUGIN_ID,
  AppearanceRegistry,
  appearanceRuntimePlugin,
} from "./appearance"

export const UI_RUNTIME_PLUGIN_ID = "orahako.runtime.ui"

const EMPTY_UI_SNAPSHOT: PluginUIServiceSnapshot = {
  pages: [],
  navigation: [],
  themes: [],
  shells: [],
}

export class PluginUIRegistry
  implements PluginUIRegistryService, ScopedPluginService<PluginUIService>
{
  readonly state: ObservableSource<PluginUIServiceSnapshot>
  private readonly stateSource = createObservableSource<PluginUIServiceSnapshot>(EMPTY_UI_SNAPSHOT)
  private readonly pages = new Map<string, PluginPageContribution>()
  private readonly navigation = new Map<string, PluginNavigationContribution>()
  private readonly themes = new Map<string, PluginThemeContribution>()
  private readonly shells = new Map<string, PluginShellContribution>()
  private generation = 0

  constructor() {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginUIService {
    const registerPageScoped = <
      Dict = undefined,
      const Children extends ChildrenSpec | undefined = undefined,
      Store = undefined,
      I = undefined,
    >(
      spec: PageSpec<Dict, Children, Store, I> & {
        readonly component?: SlotComponent<
          NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
        >
      },
      maybeComponent?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    ): (() => void) =>
      trackPluginRegistration(ctx, () =>
        this.registerPageInternal(manifest, ctx, spec, maybeComponent)
      )

    const registerShellScoped = <
      Dict = undefined,
      const Children extends ChildrenSpec | undefined = undefined,
      Store = undefined,
      I = undefined,
    >(
      spec: ShellSpec<Dict, Children, Store, I> & {
        readonly component?: SlotComponent<
          NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
        >
      },
      maybeComponent?: SlotComponent<
        NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
      >
    ): (() => void) =>
      trackPluginRegistration(ctx, () =>
        this.registerShellInternal(manifest, ctx, spec, maybeComponent)
      )

    return {
      state: this.state,
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      registerPage: registerPageScoped as PluginUIService["registerPage"],
      registerNavigation: (item) =>
        trackPluginRegistration(ctx, () => this.registerNavigationInternal(manifest.id, item)),
      registerTheme: (theme) =>
        trackPluginRegistration(ctx, () => this.registerThemeInternal(manifest.id, theme)),
      registerShell: registerShellScoped as PluginUIService["registerShell"],
    }
  }

  getSnapshot = (): PluginUIServiceSnapshot => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  findPage(pluginId: string, pageId: string): PluginPageContribution | undefined {
    return this.pages.get(`${pluginId}:${pageId}`)
  }

  findNavigation(id: string): PluginNavigationContribution | undefined {
    if (id.includes(":")) {
      return this.navigation.get(id)
    }
    return this.stateSource.getSnapshot().navigation.find((item) => item.id === id)
  }

  private registerPageInternal<
    Dict = undefined,
    Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    manifest: PluginManifest,
    registrantCtx: Context,
    spec: PageSpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void {
    if (!spec.id) {
      throw new Error("Plugin page id must not be empty")
    }
    if (spec.route !== undefined && spec.route.length === 0) {
      throw new Error("Plugin page route must not be empty")
    }
    const resolvedComponent = maybeComponent ?? spec.component
    if (typeof resolvedComponent !== "function") {
      throw new Error(`Plugin page requires a component: ${manifest.id}:${spec.id}`)
    }

    const key = `${manifest.id}:${spec.id}`
    if (this.pages.has(key)) {
      throw new Error(`Plugin UI contribution already registered: ${key}`)
    }
    if (spec.route !== undefined) {
      for (const page of this.pages.values()) {
        if (page.route === spec.route) {
          throw new Error(`Plugin page route already registered: ${spec.route}`)
        }
      }
    }

    const registrantSlots = resolvePluginSlots(registrantCtx, manifest)
    const disposeChildren = declareContributionChildren(registrantSlots, spec.children)

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      try {
        ownedStore = spec.store.create(resolvePluginStorage(registrantCtx, manifest))
        resolvedStore = ownedStore
      } catch (error) {
        disposeChildren()
        throw error
      }
    }

    const boundInject: ((ctx: Context) => unknown) | undefined = spec.inject
      ? () => spec.inject!()
      : undefined

    const registered: PluginPageContribution = {
      id: spec.id,
      pluginId: manifest.id,
      ...(spec.route !== undefined ? { route: spec.route } : {}),
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      ...(spec.titleKey !== undefined ? { titleKey: spec.titleKey } : {}),
      ...(spec.capability !== undefined ? { capability: spec.capability } : {}),
      ...(spec.requiresProvider !== undefined ? { requiresProvider: spec.requiresProvider } : {}),
      ...(spec.primary !== undefined ? { primary: spec.primary } : {}),
      ...(spec.fullscreen !== undefined ? { fullscreen: spec.fullscreen } : {}),
      ...(spec.parent !== undefined ? { parent: spec.parent } : {}),
      ...(spec.root !== undefined ? { root: spec.root } : {}),
      ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
      ...(spec.children !== undefined ? { children: spec.children } : {}),
      ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
      ...(boundInject !== undefined ? { inject: boundInject } : {}),
      component: resolvedComponent as SlotComponent<never>,
      generation: ++this.generation,
    }

    this.pages.set(key, registered)
    this.publish()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.pages.get(key) === registered) {
        this.pages.delete(key)
        this.publish()
      }
      disposeChildren()
      ownedStore?.dispose()
      ownedStore = undefined
    }
  }

  private registerNavigationInternal(
    pluginId: string,
    item: PluginNavigationDefinition
  ): () => void {
    if (!item.id) {
      throw new Error("Plugin navigation id must not be empty")
    }
    if (!item.page) {
      throw new Error(`Plugin navigation requires a target page: ${pluginId}:${item.id}`)
    }
    const key = `${pluginId}:${item.id}`
    const registered: PluginNavigationContribution = {
      ...item,
      pluginId,
    }
    return this.registerSimple(this.navigation, key, registered)
  }

  private registerThemeInternal(pluginId: string, theme: PluginThemeDefinition): () => void {
    if (!theme.id) {
      throw new Error("Plugin theme id must not be empty")
    }
    const key = `${pluginId}:${theme.id}`
    const registered: PluginThemeContribution = {
      ...theme,
      pluginId,
    }
    return this.registerSimple(this.themes, key, registered)
  }

  private registerShellInternal<
    Dict = undefined,
    Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    manifest: PluginManifest,
    registrantCtx: Context,
    spec: ShellSpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<ShellOwnerProps, Dict, Children, Store, I>>
    >
  ): () => void {
    if (!spec.id) {
      throw new Error("Plugin shell id must not be empty")
    }
    const resolvedComponent = maybeComponent ?? spec.component
    if (typeof resolvedComponent !== "function") {
      throw new Error(`Plugin shell requires a component: ${manifest.id}:${spec.id}`)
    }
    const key = `${manifest.id}:${spec.id}`
    if (this.shells.has(key)) {
      throw new Error(`Plugin UI contribution already registered: ${key}`)
    }

    const registrantSlots = resolvePluginSlots(registrantCtx, manifest)
    let disposeChildren: () => void
    if (spec.declareChildren === false) {
      assertContributionChildrenDeclared(registrantSlots, spec.children)
      disposeChildren = () => {}
    } else {
      disposeChildren = declareContributionChildren(registrantSlots, spec.children)
    }

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      try {
        ownedStore = spec.store.create(resolvePluginStorage(registrantCtx, manifest))
        resolvedStore = ownedStore
      } catch (error) {
        disposeChildren()
        throw error
      }
    }

    const boundInject: ((ctx: Context) => unknown) | undefined = spec.inject
      ? () => spec.inject!()
      : undefined

    const registered: PluginShellContribution = {
      id: spec.id,
      pluginId: manifest.id,
      name: spec.name,
      ...(spec.supportsThemes !== undefined ? { supportsThemes: spec.supportsThemes } : {}),
      ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
      ...(spec.children !== undefined ? { children: spec.children } : {}),
      ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
      ...(boundInject !== undefined ? { inject: boundInject } : {}),
      component: resolvedComponent as SlotComponent<never>,
      generation: ++this.generation,
    }

    this.shells.set(key, registered)
    this.publish()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.shells.get(key) === registered) {
        this.shells.delete(key)
        this.publish()
      }
      disposeChildren()
      ownedStore?.dispose()
      ownedStore = undefined
    }
  }

  private registerSimple<T>(registry: Map<string, T>, key: string, value: T): () => void {
    if (registry.has(key)) {
      throw new Error(`Plugin UI contribution already registered: ${key}`)
    }
    registry.set(key, value)
    this.publish()
    return () => {
      if (registry.get(key) !== value) return
      registry.delete(key)
      this.publish()
    }
  }

  private publish(): void {
    const next: PluginUIServiceSnapshot = {
      pages: Array.from(this.pages.values()),
      navigation: Array.from(this.navigation.values()).sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          (a.title ?? a.titleKey ?? a.id).localeCompare(b.title ?? b.titleKey ?? b.id) ||
          a.id.localeCompare(b.id)
      ),
      themes: Array.from(this.themes.values()),
      shells: Array.from(this.shells.values()),
    }
    this.stateSource.set(next)
  }
}

export const uiRegistryPlugin = definePlugin({
  manifest: {
    id: UI_RUNTIME_PLUGIN_ID,
    name: "界面注册表",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "插件页面、导航、主题与 Shell 的根注册表",
    provides: ["ui"],
  },
  optionalInject: ["slots", "storage"],
  apply(ctx) {
    ctx.set("ui", new PluginUIRegistry())
  },
})
