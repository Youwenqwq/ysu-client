import type { Context } from "@cordisjs/core"
import type {
  OverviewService,
  OverviewWidgetContribution,
  OverviewWidgetSpec,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  PLUGIN_SERVICE_SCOPE,
  resolveContributionText,
  resolvePluginSlots,
  resolvePluginStorage,
  trackPluginRegistration,
  type ChildrenSpec,
  type DerivedComponentProps,
  type ObservableSource,
  type PluginI18nService,
  type PluginLocale,
  type PluginManifest,
  type PluginSlotService,
  type PluginStorageService,
  type ScopedPluginService,
  type SlotComponent,
  type StoreDefinition,
  type StoreInstance,
} from "@orahako/sdk"
import "./slots"

const DEFAULT_WIDGET_ORDER = 100

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

export function resolveOverviewWidgetText(
  widget: OverviewWidgetContribution,
  kind: "title" | "description",
  locale: PluginLocale,
  i18nRegistry?: Pick<PluginI18nService, "translate">
): string {
  return resolveContributionText({
    dictionary: widget.dictionary,
    key: kind === "title" ? widget.titleKey : widget.descriptionKey,
    literal: kind === "title" ? widget.title : widget.description,
    fallback: widget.id,
    locale,
    pluginId: widget.pluginId,
    i18n: i18nRegistry,
  })
}

export function overviewWidgetSlotKey(pluginId: string, widgetId: string): string {
  return `${pluginId}:${widgetId}`
}

export class OverviewRegistry implements OverviewService, ScopedPluginService<OverviewService> {
  readonly state: ObservableSource<readonly OverviewWidgetContribution[]>
  private readonly stateSource = createObservableSource<readonly OverviewWidgetContribution[]>([])
  private readonly widgets = new Map<string, OverviewWidgetContribution>()

  constructor(
    private readonly ownerSlots: PluginSlotService,
    private readonly ownerStorage: PluginStorageService
  ) {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): OverviewService {
    // Consumers receive slots/storage scoped to their own plugin identity so
    // widget contributions and stores keep the consumer's namespace.
    return this.createFacade(
      ctx,
      manifest,
      resolvePluginSlots(ctx, manifest) ?? this.ownerSlots,
      resolvePluginStorage(ctx, manifest) ?? this.ownerStorage
    )
  }

  createScopedFacade(ctx: Pick<Context, "effect">, manifest: PluginManifest): OverviewService {
    return this.createFacade(ctx, manifest, this.ownerSlots, this.ownerStorage)
  }

  private createFacade(
    ctx: Pick<Context, "effect">,
    manifest: PluginManifest,
    slots: PluginSlotService,
    storage: PluginStorageService
  ): OverviewService {
    const registerScoped = <
      Dict = undefined,
      const Children extends ChildrenSpec | undefined = undefined,
      Store = undefined,
      I = undefined,
    >(
      spec: OverviewWidgetSpec<Dict, Children, Store, I> & {
        readonly component?: SlotComponent<
          NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
        >
      },
      maybeComponent?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    ): (() => void) =>
      trackPluginRegistration(ctx, () =>
        this.registerInternal(manifest, spec, maybeComponent, slots, storage)
      )

    return {
      state: this.state,
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
      registerWidget: registerScoped as OverviewService["registerWidget"],
    }
  }

  getSnapshot = (): readonly OverviewWidgetContribution[] => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  registerWidget<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: OverviewWidgetSpec<Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void
  registerWidget<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: OverviewWidgetSpec<Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    }
  ): () => void
  registerWidget<
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: OverviewWidgetSpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    },
    maybeComponent?: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    >
  ): () => void {
    return this.registerInternal(
      undefined,
      spec,
      maybeComponent,
      this.ownerSlots,
      this.ownerStorage
    )
  }

  private registerInternal<
    Dict = undefined,
    Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    manifest: PluginManifest | undefined,
    spec: OverviewWidgetSpec<Dict, Children, Store, I> & {
      readonly component?: SlotComponent<
        NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
      >
    },
    maybeComponent: SlotComponent<
      NoInfer<DerivedComponentProps<Record<string, never>, Dict, Children, Store, I>>
    > | undefined,
    explicitSlots: PluginSlotService,
    explicitStorage: PluginStorageService
  ): () => void {
    if (!spec.id) {
      throw new Error("Overview widget id must not be empty")
    }
    const resolvedComponent = maybeComponent ?? spec.component
    if (typeof resolvedComponent !== "function") {
      throw new Error(`Overview widget requires a component: ${spec.id}`)
    }

    const pluginId = manifest?.id ?? "root"
    const slotKey = overviewWidgetSlotKey(pluginId, spec.id)
    if (this.widgets.has(slotKey)) {
      throw new Error(`Overview widget already registered: ${slotKey}`)
    }

    let ownedStore: StoreInstance<unknown, Record<string, never>> | undefined
    let resolvedStore: unknown = spec.store
    if (isStoreDefinition(spec.store)) {
      ownedStore = spec.store.create(explicitStorage)
      resolvedStore = ownedStore
    }

    const boundInject: (() => unknown) | undefined = spec.inject
      ? () => spec.inject!()
      : undefined

    const contribution: OverviewWidgetContribution = {
      id: spec.id,
      pluginId,
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      ...(spec.titleKey !== undefined ? { titleKey: spec.titleKey } : {}),
      ...(spec.description !== undefined ? { description: spec.description } : {}),
      ...(spec.descriptionKey !== undefined ? { descriptionKey: spec.descriptionKey } : {}),
      icon: spec.icon,
      region: spec.region,
      defaultVisible: spec.defaultVisible,
      ...(spec.order !== undefined ? { order: spec.order } : {}),
      ...(spec.slice !== undefined ? { slice: spec.slice } : {}),
      ...(spec.capability !== undefined ? { capability: spec.capability } : {}),
      ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
      ...(spec.children !== undefined ? { children: spec.children } : {}),
      ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
      ...(boundInject !== undefined ? { inject: boundInject } : {}),
      component: resolvedComponent as SlotComponent<never>,
    }

    let disposeSlotInject: (() => void) | undefined

    const attachToSlotService = (slots: PluginSlotService): void => {
      const slotComponent: SlotComponent<
        DerivedComponentProps<
          Record<string, never>,
          unknown,
          ChildrenSpec | undefined,
          unknown,
          unknown
        >
      > = (props) => contribution.component(props as never)
      disposeSlotInject = slots.inject("overview.widget", () =>
        slots.register<"overview.widget", unknown, ChildrenSpec | undefined, unknown, unknown>(
          {
            id: `overview-widget-${spec.id}`,
            slot: "overview.widget",
            key: slotKey,
            ...(spec.order !== undefined ? { order: spec.order } : {}),
            ...(spec.dictionary !== undefined ? { dictionary: spec.dictionary } : {}),
            ...(spec.children !== undefined ? { children: spec.children } : {}),
            ...(resolvedStore !== undefined ? { store: resolvedStore } : {}),
            ...(boundInject !== undefined ? { inject: boundInject } : {}),
          },
          slotComponent
        )
      )
    }

    try {
      attachToSlotService(explicitSlots)
    } catch (error) {
      ownedStore?.dispose()
      throw error
    }

    this.widgets.set(slotKey, contribution)
    this.publish()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      disposeSlotInject?.()
      disposeSlotInject = undefined
      if (this.widgets.get(slotKey) === contribution) {
        this.widgets.delete(slotKey)
        this.publish()
      }
      ownedStore?.dispose()
      ownedStore = undefined
    }
  }

  private publish(): void {
    const sorted = Array.from(this.widgets.values()).sort(
      (a, b) => (a.order ?? DEFAULT_WIDGET_ORDER) - (b.order ?? DEFAULT_WIDGET_ORDER)
    )
    this.stateSource.set(sorted)
  }
}
