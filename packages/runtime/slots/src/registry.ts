import { Context } from "@cordisjs/core"
import {
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
  type PluginManifest,
  type PluginSlotDeclaration,
  type PluginSlotRegistryService,
  type PluginSlotRegistrySnapshot,
  type PluginSlotService,
  type ScopedPluginService,
  type SlotComponent,
  type SlotComponentOwner,
  type SlotContribution,
  type SlotInjectCallback,
  type SlotKind,
  type SlotName,
  type SlotRegistrationSpec,
  type StoreInstance,
} from "@orahako/sdk"

export const SLOTS_RUNTIME_PLUGIN_ID = "orahako.runtime.slots"
const DEFAULT_PRIORITY = 100
const DEFAULT_ORDER = 100
const VALID_SLOT_KINDS = new Set<SlotKind>(["single", "list", "keyed", "chain"])

interface InternalDeclaration {
  readonly name: SlotName
  readonly kind: SlotKind
  refs: number
}

interface InternalContribution {
  readonly key: string
  readonly entry: SlotContribution
  cleanup(): void
}

interface InjectWatcher {
  readonly slotName: SlotName
  readonly callback: SlotInjectCallback
  readonly registrantCtx?: Context
  permanentlyDisposed: boolean
  unwindCurrentRun?: () => void
}

export class PluginSlotRegistry
  implements PluginSlotRegistryService, ScopedPluginService<PluginSlotService>
{
  readonly state: ObservableSource<PluginSlotRegistrySnapshot>
  private readonly stateSource: ReturnType<
    typeof createObservableSource<PluginSlotRegistrySnapshot>
  >
  private readonly declarations = new Map<SlotName, InternalDeclaration>()
  private readonly contributions = new Map<string, InternalContribution>()
  private readonly injectWatchers = new Set<InjectWatcher>()
  private readonly activeManualCollectors: Array<Array<() => void>> = []
  private readonly fallbackContext = new Context()
  private generation = 0
  private autoIdCounter = 0
  private batchDepth = 0
  private batchDirty = false

  constructor() {
    const rootDeclaration: InternalDeclaration = { name: "root", kind: "single", refs: 1 }
    this.declarations.set("root", rootDeclaration)
    this.stateSource = createObservableSource<PluginSlotRegistrySnapshot>({
      declarations: [{ name: "root", kind: "single" }],
      contributions: [],
    })
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): PluginSlotService {
    const registerScoped = <
      S extends SlotName,
      Dict = undefined,
      const Children extends ChildrenSpec | undefined = undefined,
      Store = undefined,
      I = undefined,
    >(
      spec: SlotRegistrationSpec<S, Dict, Children, Store, I> & {
        readonly component?: SlotComponent<
          NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
        >
      },
      maybeComponent?: SlotComponent<
        NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
      >
    ): (() => void) =>
      trackPluginRegistration(ctx, () => this.registerInternal(manifest, ctx, spec, maybeComponent))

    return {
      state: this.state,
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      register: registerScoped as PluginSlotService["register"],
      inject: <S extends SlotName>(slotName: S, callback: SlotInjectCallback): (() => void) =>
        trackPluginRegistration(ctx, () => this.injectInternal(slotName, callback, ctx)),
      declare: (slot: PluginSlotDeclaration): (() => void) =>
        trackPluginRegistration(ctx, () => this.claimDeclaration(slot)),
    }
  }

  getSnapshot = (): PluginSlotRegistrySnapshot => {
    // Authoritative live view: nested registrations during a batched teardown
    // must observe declarations removed earlier in the same batch.
    return this.buildSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  declare = (slot: PluginSlotDeclaration): (() => void) => {
    return this.createDeclaration(slot)
  }

  private createDeclaration(slot: PluginSlotDeclaration): () => void {
    this.validateSlotDeclaration(slot.name, slot.kind)
    const registered: InternalDeclaration = {
      name: slot.name,
      kind: slot.kind,
      refs: 1,
    }

    this.withBatch(() => {
      this.declarations.set(slot.name, registered)
      this.markDirty()
      this.notifySlotDeclared(slot.name)
    })

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.releaseDeclaration(slot.name, registered)
    }
  }

  /**
   * Scoped declaration claim: an existing declaration with the same kind is
   * shared by reference count so multiple shells can take over public slots.
   */
  private claimDeclaration(slot: PluginSlotDeclaration): () => void {
    const existing = this.declarations.get(slot.name)
    if (!existing) {
      return this.createDeclaration(slot)
    }
    if (existing.kind !== slot.kind) {
      throw new Error(
        `Plugin slot already declared with kind ${existing.kind}: ${slot.name} (requested ${slot.kind})`
      )
    }
    existing.refs += 1
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      this.releaseDeclaration(slot.name, existing)
    }
  }

  private releaseDeclaration(name: SlotName, expected: InternalDeclaration): void {
    if (this.declarations.get(name) !== expected) return
    expected.refs -= 1
    if (expected.refs > 0) return
    this.teardownDeclaration(name, expected)
  }

  select = (name: SlotName, itemKey?: string): readonly SlotContribution[] => {
    const declaration = this.declarations.get(name)
    if (!declaration) return []
    const snapshot = this.stateSource.getSnapshot()
    const matching = snapshot.contributions.filter((contribution) => {
      if (contribution.slot !== name) return false
      return declaration.kind !== "keyed" || contribution.key === itemKey
    })
    if (declaration.kind === "list" || declaration.kind === "chain") {
      return matching
    }
    return [...matching]
      .sort(
        (a, b) =>
          (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY) ||
          a.id.localeCompare(b.id)
      )
      .slice(0, 1)
  }

  register<
    S extends SlotName,
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
    >
  ): () => void
  register<
    S extends SlotName,
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
      >
    }
  ): () => void
  register<
    S extends SlotName,
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
    >
  ): () => void {
    const disposer = this.registerInternal(undefined, undefined, spec, maybeComponent)
    this.recordManualDisposer(disposer)
    return disposer
  }

  inject = <S extends SlotName>(slotName: S, callback: SlotInjectCallback): (() => void) => {
    const disposer = this.injectInternal(slotName, callback, undefined)
    this.recordManualDisposer(disposer)
    return disposer
  }

  private registerInternal<
    S extends SlotName,
    Dict = undefined,
    Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    manifest: PluginManifest | undefined,
    registrantCtx: Context | undefined,
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
    >
  ): () => void {
    if (spec.id !== undefined && spec.id.length === 0) {
      throw new Error("Plugin slot contribution ID must not be empty")
    }
    const resolvedComponent = maybeComponent ?? spec.component
    if (typeof resolvedComponent !== "function") {
      throw new Error(`Plugin slot contribution requires a component: ${spec.slot}`)
    }

    const declaration = this.declarations.get(spec.slot)
    if (!declaration) {
      throw new Error(`Plugin slot is not declared: ${spec.slot}`)
    }
    if (declaration.kind === "keyed" && !spec.key) {
      throw new Error(`Keyed plugin slot contribution requires a key: ${spec.slot}`)
    }
    if (declaration.kind !== "keyed" && spec.key !== undefined) {
      throw new Error(`Only keyed plugin slot contributions may declare a key: ${spec.slot}`)
    }

    const pluginId = manifest?.id ?? ""
    const resolvedId = spec.id ?? `auto-${++this.autoIdCounter}`
    const contributionKey = `${pluginId}:${spec.slot}:${resolvedId}`
    if (this.contributions.has(contributionKey)) {
      throw new Error(`Plugin slot contribution already registered: ${contributionKey}`)
    }

    this.assertUnambiguous(declaration, spec.slot, spec.key, spec.priority)

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      const storage =
        registrantCtx && manifest ? resolvePluginStorage(registrantCtx, manifest) : undefined
      ownedStore = spec.store.create(storage)
      resolvedStore = ownedStore
    }

    const boundInject: ((ctx: Context) => unknown) | undefined = spec.inject
      ? () => spec.inject!()
      : undefined

    const entry: SlotContribution = {
      id: resolvedId,
      pluginId,
      slot: spec.slot,
      ...(spec.priority !== undefined ? { priority: spec.priority } : {}),
      ...(spec.order !== undefined ? { order: spec.order } : {}),
      ...(spec.key !== undefined ? { key: spec.key } : {}),
      ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
      ...(spec.children !== undefined ? { children: spec.children } : {}),
      ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
      ...(boundInject !== undefined ? { inject: boundInject } : {}),
      component: resolvedComponent as SlotComponent<never>,
      generation: ++this.generation,
    }

    let disposeChildren: (() => void) | undefined
    let cleanedUp = false

    const record: InternalContribution = {
      key: contributionKey,
      entry,
      cleanup: () => {
        if (cleanedUp) return
        cleanedUp = true
        this.withBatch(() => {
          const releaseChildren = disposeChildren
          disposeChildren = undefined
          releaseChildren?.()
          ownedStore?.dispose()
          ownedStore = undefined
          if (this.contributions.get(contributionKey) === record) {
            this.contributions.delete(contributionKey)
            this.markDirty()
          }
        })
      },
    }

    this.withBatch(() => {
      this.contributions.set(contributionKey, record)
      this.markDirty()
      try {
        disposeChildren =
          registrantCtx && manifest
            ? declareContributionChildren(
                resolvePluginSlots(registrantCtx, manifest),
                spec.children
              )
            : this.declareChildrenDirect(spec.children)
      } catch (error) {
        record.cleanup()
        throw error
      }
    })

    return () => {
      record.cleanup()
    }
  }

  private declareChildrenDirect(children: ChildrenSpec | undefined): () => void {
    if (!children) return () => {}
    const disposers: Array<() => void> = []
    const release = (): void => {
      for (let i = disposers.length - 1; i >= 0; i -= 1) {
        disposers[i]?.()
      }
      disposers.length = 0
    }
    try {
      for (const [childName, childSpec] of Object.entries(children)) {
        if (!childSpec) continue
        disposers.push(this.declare({ name: childName as SlotName, kind: childSpec.kind }))
      }
    } catch (error) {
      release()
      throw error
    }
    return release
  }

  private injectInternal(
    slotName: SlotName,
    callback: SlotInjectCallback,
    registrantCtx: Context | undefined
  ): () => void {
    if (!slotName) {
      throw new Error("Plugin slot name must not be empty")
    }
    const watcher: InjectWatcher = {
      slotName,
      callback,
      registrantCtx,
      permanentlyDisposed: false,
    }
    this.injectWatchers.add(watcher)

    if (this.declarations.has(slotName)) {
      try {
        this.activateWatcher(watcher, true)
      } catch (error) {
        watcher.permanentlyDisposed = true
        this.injectWatchers.delete(watcher)
        throw error
      }
    }

    return () => {
      if (watcher.permanentlyDisposed) return
      watcher.permanentlyDisposed = true
      this.injectWatchers.delete(watcher)
      const unwind = watcher.unwindCurrentRun
      watcher.unwindCurrentRun = undefined
      unwind?.()
    }
  }

  private activateWatcher(watcher: InjectWatcher, rethrowOnError: boolean): void {
    if (watcher.permanentlyDisposed || watcher.unwindCurrentRun) return
    if (watcher.registrantCtx && !watcher.registrantCtx.scope.isActive) return

    const ctxForCallback = watcher.registrantCtx ?? this.fallbackContext
    const beforeScopeDisposables = watcher.registrantCtx
      ? new Set(watcher.registrantCtx.scope.disposables)
      : undefined
    const manualCollector: Array<() => void> = []
    this.activeManualCollectors.push(manualCollector)

    let returnedDisposer: void | (() => void)
    try {
      returnedDisposer = watcher.callback(ctxForCallback)
    } catch (error) {
      this.activeManualCollectors.pop()
      const partialScopeDisposables =
        watcher.registrantCtx && beforeScopeDisposables
          ? watcher.registrantCtx.scope.disposables.filter((d) => !beforeScopeDisposables.has(d))
          : []
      for (let i = manualCollector.length - 1; i >= 0; i -= 1) {
        manualCollector[i]?.()
      }
      for (let i = partialScopeDisposables.length - 1; i >= 0; i -= 1) {
        partialScopeDisposables[i]?.()
      }
      if (rethrowOnError || !watcher.registrantCtx) {
        throw error
      }
      watcher.registrantCtx.emit(watcher.registrantCtx, "internal/error", error)
      return
    }

    this.activeManualCollectors.pop()
    const addedScopeDisposables =
      watcher.registrantCtx && beforeScopeDisposables
        ? watcher.registrantCtx.scope.disposables.filter((d) => !beforeScopeDisposables.has(d))
        : []

    let unwound = false
    watcher.unwindCurrentRun = () => {
      if (unwound) return
      unwound = true
      this.withBatch(() => {
        if (typeof returnedDisposer === "function") {
          returnedDisposer()
        }
        for (let i = manualCollector.length - 1; i >= 0; i -= 1) {
          manualCollector[i]?.()
        }
        for (let i = addedScopeDisposables.length - 1; i >= 0; i -= 1) {
          addedScopeDisposables[i]?.()
        }
      })
    }
  }

  private notifySlotDeclared(slotName: SlotName): void {
    for (const watcher of Array.from(this.injectWatchers)) {
      if (watcher.slotName !== slotName || watcher.permanentlyDisposed) continue
      if (!this.declarations.has(slotName)) break
      this.activateWatcher(watcher, false)
    }
  }

  private teardownDeclaration(slotName: SlotName, expected: InternalDeclaration): void {
    this.withBatch(() => {
      if (this.declarations.get(slotName) !== expected) return
      this.declarations.delete(slotName)
      this.markDirty()

      // Unwind any active inject runs targeting this slot while keeping watchers alive for redeclaration.
      for (const watcher of Array.from(this.injectWatchers)) {
        if (watcher.slotName !== slotName) continue
        const unwind = watcher.unwindCurrentRun
        watcher.unwindCurrentRun = undefined
        unwind?.()
      }

      // Clean up any remaining direct contributions targeting this slot (including their stores and child slots).
      for (const record of Array.from(this.contributions.values())) {
        if (record.entry.slot === slotName) {
          record.cleanup()
        }
      }
    })
  }

  private validateSlotDeclaration(name: SlotName, kind: SlotKind): void {
    if (!name) {
      throw new Error("Plugin slot name must not be empty")
    }
    if (!VALID_SLOT_KINDS.has(kind)) {
      throw new Error(`Invalid plugin slot kind: ${String(kind)}`)
    }
    if (this.declarations.has(name)) {
      throw new Error(`Plugin slot already declared: ${name}`)
    }
  }

  private assertUnambiguous(
    declaration: InternalDeclaration,
    slot: SlotName,
    itemKey: string | undefined,
    priority: number | undefined
  ): void {
    if (declaration.kind === "list" || declaration.kind === "chain") return
    const effectivePriority = priority ?? DEFAULT_PRIORITY
    for (const { entry } of this.contributions.values()) {
      if (entry.slot !== slot) continue
      if (declaration.kind === "keyed" && entry.key !== itemKey) continue
      if ((entry.priority ?? DEFAULT_PRIORITY) === effectivePriority) {
        throw new Error(
          `Plugin slot contribution has an ambiguous priority: ${slot} (${effectivePriority})`
        )
      }
    }
  }

  private recordManualDisposer(disposer: () => void): void {
    const collector = this.activeManualCollectors[this.activeManualCollectors.length - 1]
    if (collector) {
      collector.push(disposer)
    }
  }

  private markDirty(): void {
    this.batchDirty = true
  }

  private withBatch<T>(fn: () => T): T {
    this.batchDepth += 1
    try {
      return fn()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0 && this.batchDirty) {
        this.batchDirty = false
        this.publish()
      }
    }
  }

  private buildSnapshot(): PluginSlotRegistrySnapshot {
    const declarations: PluginSlotDeclaration[] = Array.from(
      this.declarations.values(),
      (item) => ({
        name: item.name,
        kind: item.kind,
      })
    )
    const contributions: SlotContribution[] = Array.from(
      this.contributions.values(),
      (item) => item.entry
    ).sort(
      (a, b) =>
        (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER) ||
        (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY) ||
        a.pluginId.localeCompare(b.pluginId) ||
        a.id.localeCompare(b.id)
    )
    return { declarations, contributions }
  }

  private publish(): void {
    this.stateSource.set(this.buildSnapshot())
  }
}

export const slotRegistryPlugin = definePlugin({
  manifest: {
    id: SLOTS_RUNTIME_PLUGIN_ID,
    name: "插槽注册表",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "插件插槽声明与贡献的根注册表",
    provides: ["slots"],
  },
  apply(ctx) {
    ctx.set("slots", new PluginSlotRegistry())
  },
})
