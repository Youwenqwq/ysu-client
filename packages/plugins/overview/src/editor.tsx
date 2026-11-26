import { useEffect, useId, useState, type ComponentType } from "react"
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react"
import {
  createDefaultOverviewLayout,
  isOverviewWidgetId,
  moveOverviewWidget,
  normalizeOverviewLayout,
  pluginOverviewWidgetId,
  type DynamicOverviewWidget,
  type OverviewLayout,
  type OverviewRegion,
  type OverviewWidgetId,
} from "@orahako/academic-kit"
import type { OverviewWidgetContribution, ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginLocale,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Skeleton,
  useIsMobile,
} from "@orahako/ui-primitives"
import { isWidgetSupportedByProvider, OVERVIEW_PROFILE_WIDGET_ID } from "./page"
import type { OverviewDictionary, OverviewLayoutStoreInstance } from "./store"

type WidgetIcon = ComponentType<{ className?: string }>

export interface ResolvedWidgetMeta {
  readonly title: string
  readonly description: string
  readonly icon: WidgetIcon
  readonly region: OverviewRegion
}

export interface OverviewEditorInject {
  readonly hooks: {
    readonly layoutHydrated: ObservableSource<boolean>
    readonly widgets: ObservableSource<readonly OverviewWidgetContribution[]>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
  readonly resolveWidgetMeta: (
    widget: OverviewWidgetContribution,
    locale: PluginLocale
  ) => ResolvedWidgetMeta
  readonly openOverview: () => void
  readonly openSettings: () => void
}

export type OverviewLayoutEditorProps = DerivedComponentProps<
  Record<string, never>,
  OverviewDictionary,
  undefined,
  OverviewLayoutStoreInstance,
  OverviewEditorInject
>

function SortablePreview({
  id,
  title,
  description,
  icon: Icon,
  first,
  last,
  t,
  onMove,
  onHide,
}: {
  readonly id: OverviewWidgetId
  readonly title: string
  readonly description: string
  readonly icon: WidgetIcon
  readonly first: boolean
  readonly last: boolean
  readonly t: Translator<OverviewDictionary>
  readonly onMove: (direction: -1 | 1) => void
  readonly onHide: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("min-w-0", isDragging && "relative opacity-60")}
    >
      <Card className="h-full" size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="mt-auto">
          <p className="text-xs text-muted-foreground">{t("layout.preview")}</p>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-1">
          <Button
            ref={setActivatorNodeRef}
            variant="ghost"
            size="icon-lg"
            className="cursor-grab touch-none active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={t("layout.drag", { title })}
          >
            <GripVertical />
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-lg"
              disabled={first}
              onClick={() => onMove(-1)}
              aria-label={t("layout.moveUp", { title })}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              disabled={last}
              onClick={() => onMove(1)}
              aria-label={t("layout.moveDown", { title })}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onHide}
              aria-label={t("layout.hide", { title })}
            >
              <EyeOff />
            </Button>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}

function EditableRegion({
  region,
  layout,
  profileLayoutId,
  metaById,
  t,
  onMove,
  onHide,
}: {
  readonly region: OverviewRegion
  readonly layout: OverviewLayout
  readonly profileLayoutId: OverviewWidgetId
  readonly metaById: ReadonlyMap<OverviewWidgetId, ResolvedWidgetMeta>
  readonly t: Translator<OverviewDictionary>
  readonly onMove: (active: OverviewWidgetId, target: OverviewWidgetId) => void
  readonly onHide: (id: OverviewWidgetId) => void
}) {
  const contextId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const items = layout.items.flatMap((item) => {
    if (!item.visible || item.id === profileLayoutId) return []
    const widget = metaById.get(item.id)
    return widget?.region === region ? [{ id: item.id, ...widget }] : []
  })

  const titleFor = (id: string | number): string =>
    isOverviewWidgetId(id) ? (metaById.get(id)?.title ?? "") : ""

  const regionTitle = region === "summary" ? t("layout.summary") : t("layout.content")

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${contextId}-title`}>
      <h2 id={`${contextId}-title`} className="text-sm font-medium">
        {regionTitle}
      </h2>
      <DndContext
        id={contextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: { draggable: t("layout.keyboardInstructions") },
          announcements: {
            onDragStart: ({ active }) => t("layout.dragStart", { title: titleFor(active.id) }),
            onDragOver: ({ active, over }) =>
              over
                ? t("layout.dragOver", {
                    title: titleFor(active.id),
                    target: titleFor(over.id),
                  })
                : t("layout.dragStart", { title: titleFor(active.id) }),
            onDragEnd: ({ active }) => t("layout.dragEnd", { title: titleFor(active.id) }),
            onDragCancel: ({ active }) => t("layout.dragCancel", { title: titleFor(active.id) }),
          },
        }}
        onDragEnd={({ active, over }) => {
          if (over && isOverviewWidgetId(active.id) && isOverviewWidgetId(over.id)) {
            onMove(active.id, over.id)
          }
        }}
      >
        <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item, index) => (
              <SortablePreview
                key={item.id}
                id={item.id}
                title={item.title}
                description={item.description}
                icon={item.icon}
                first={index === 0}
                last={index === items.length - 1}
                t={t}
                onMove={(direction) => {
                  const target = items[index + direction]
                  if (target) onMove(item.id, target.id)
                }}
                onHide={() => onHide(item.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{t("layout.regionEmpty")}</EmptyTitle>
            <EmptyDescription>{t("layout.regionEmptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

function AddLibrary({
  layout,
  profileLayoutId,
  metaById,
  t,
  onAdd,
}: {
  readonly layout: OverviewLayout
  readonly profileLayoutId: OverviewWidgetId
  readonly metaById: ReadonlyMap<OverviewWidgetId, ResolvedWidgetMeta>
  readonly t: Translator<OverviewDictionary>
  readonly onAdd: (id: OverviewWidgetId) => void
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  const hidden = layout.items.flatMap((item) => {
    if (item.visible || item.id === profileLayoutId) return []
    const widget = metaById.get(item.id)
    return widget ? [{ id: item.id, ...widget }] : []
  })

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
      {(["summary", "content"] as const).map((region) => {
        const items = hidden.filter((item) => item.region === region)
        const regionLabel = region === "summary" ? t("layout.summary") : t("layout.content")
        return (
          <section key={region} className="flex flex-col gap-3" aria-label={regionLabel}>
            <h3 className="text-sm font-medium">{regionLabel}</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("layout.allAdded")}</p>
            ) : (
              items.map(({ id, title, description, icon: Icon }) => (
                <Card key={id} size="sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-4" aria-hidden="true" />
                      {title}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardFooter className="justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{t("layout.preview")}</span>
                    <Button
                      variant="outline"
                      onClick={() => onAdd(id)}
                      aria-label={t("layout.addWidget", { title })}
                    >
                      <Plus data-icon="inline-start" />
                      {t("layout.add")}
                    </Button>
                  </CardFooter>
                </Card>
              ))
            )}
          </section>
        )
      })}
    </div>
  )

  const trigger = (
    <Button variant="outline">
      <Plus data-icon="inline-start" />
      {t("layout.addWidgets")}
    </Button>
  )
  const close = (
    <Button variant="outline" onClick={() => setOpen(false)}>
      {t("layout.done")}
    </Button>
  )

  return isMobile ? (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("layout.addWidgets")}</DrawerTitle>
          <DrawerDescription>{t("layout.libraryDescription")}</DrawerDescription>
        </DrawerHeader>
        {content}
        <DrawerFooter>{close}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  ) : (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>{t("layout.addWidgets")}</SheetTitle>
          <SheetDescription>{t("layout.libraryDescription")}</SheetDescription>
        </SheetHeader>
        {content}
        <SheetFooter>{close}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function LayoutEditorBody({
  initialLayout,
  dynamicWidgets,
  profileLayoutId,
  metaById,
  t,
  onSave,
  onCancel,
}: {
  readonly initialLayout: OverviewLayout
  readonly dynamicWidgets: readonly DynamicOverviewWidget[]
  readonly profileLayoutId: OverviewWidgetId
  readonly metaById: ReadonlyMap<OverviewWidgetId, ResolvedWidgetMeta>
  readonly t: Translator<OverviewDictionary>
  readonly onSave: (nextLayout: OverviewLayout) => void
  readonly onCancel: () => void
}) {
  const [draft, setDraft] = useState(() => normalizeOverviewLayout(initialLayout, dynamicWidgets))

  const dynamicSignature = dynamicWidgets
    .map((widget) => `${widget.id}:${widget.region}:${String(widget.defaultVisible)}`)
    .join("|")

  useEffect(() => {
    setDraft((current) => normalizeOverviewLayout(current, dynamicWidgets))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconciled on contribution signature change
  }, [dynamicSignature])

  function setVisibility(id: OverviewWidgetId, visible: boolean) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, visible } : item)),
    }))
  }

  function toggleProfileVisible() {
    setDraft((current) => {
      const nextProfileVisible = !current.profileVisible
      return {
        ...current,
        profileVisible: nextProfileVisible,
        items: current.items.map((item) =>
          item.id === profileLayoutId ? { ...item, visible: nextProfileVisible } : item
        ),
      }
    })
  }

  return (
    <div data-overview-editor="" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("layout.editDescription")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => onSave(draft)}>
            <Check data-icon="inline-start" />
            {t("layout.save")}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            {t("layout.cancel")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDraft(createDefaultOverviewLayout(dynamicWidgets))}
          >
            <RotateCcw data-icon="inline-start" />
            {t("layout.reset")}
          </Button>
          <AddLibrary
            layout={draft}
            profileLayoutId={profileLayoutId}
            metaById={metaById}
            t={t}
            onAdd={(id) => setVisibility(id, true)}
          />
        </div>
      </header>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4" aria-hidden="true" />
            {t("layout.profile")}
          </CardTitle>
          <CardDescription>{t("layout.profileDescription")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="outline"
            aria-pressed={draft.profileVisible}
            onClick={toggleProfileVisible}
          >
            {draft.profileVisible ? (
              <Eye data-icon="inline-start" />
            ) : (
              <EyeOff data-icon="inline-start" />
            )}
            {t(draft.profileVisible ? "layout.profileShown" : "layout.profileHidden")}
          </Button>
        </CardFooter>
      </Card>

      {(["summary", "content"] as const).map((region) => (
        <EditableRegion
          key={region}
          region={region}
          layout={draft}
          profileLayoutId={profileLayoutId}
          metaById={metaById}
          t={t}
          onMove={(active, target) =>
            setDraft((current) => moveOverviewWidget(current, active, target, dynamicWidgets))
          }
          onHide={(id) => setVisibility(id, false)}
        />
      ))}
    </div>
  )
}

export const OverviewLayoutEditor: SlotComponent<OverviewLayoutEditorProps> = (props) => {
  const { t, locale, useStore, actions } = props
  const hydrated = props.useLayoutHydrated()
  const widgets = props.useWidgets()
  const providerSnap = props.useProvider()
  const storedLayout = useStore((s) => s.overviewLayout)

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t("layout.loading")}>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const available = widgets.filter((widget) =>
    isWidgetSupportedByProvider(widget, providerSnap.provider)
  )
  const dynamicWidgets: DynamicOverviewWidget[] = available.map((widget) => ({
    id: pluginOverviewWidgetId(widget.pluginId, widget.id),
    region: widget.region,
    defaultVisible: widget.defaultVisible,
  }))

  const metaById = new Map<OverviewWidgetId, ResolvedWidgetMeta>()
  for (const widget of available) {
    metaById.set(
      pluginOverviewWidgetId(widget.pluginId, widget.id),
      props.resolveWidgetMeta(widget, locale)
    )
  }

  const profileLayoutId = pluginOverviewWidgetId(props.pluginId, OVERVIEW_PROFILE_WIDGET_ID)

  return (
    <LayoutEditorBody
      initialLayout={storedLayout}
      dynamicWidgets={dynamicWidgets}
      profileLayoutId={profileLayoutId}
      metaById={metaById}
      t={t}
      onSave={(nextLayout) => {
        actions.setOverviewLayout(nextLayout)
        props.openOverview()
      }}
      onCancel={props.openSettings}
    />
  )
}
