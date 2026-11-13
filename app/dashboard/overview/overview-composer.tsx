"use client"

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
  LayoutDashboard,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react"
import { usePluginHost } from "@/components/plugin-provider"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslation } from "@/lib/i18n/use-translation"
import type { RegisteredPluginOverviewWidget } from "@/lib/plugins/ui-registry"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { useSettingsStore } from "@/lib/stores/settings"
import { cn } from "@/lib/utils"
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
} from "./layout-config"

type WidgetIcon = ComponentType<{ className?: string }>

interface OverviewWidgetMeta {
  title: string
  description: string
  icon: WidgetIcon
  region: OverviewRegion
}

function useOverviewWidgetMeta() {
  const { locale } = useTranslation()
  const { host } = usePluginHost()
  const { overviewWidgets } = usePluginUI(host.ui)
  const dynamicWidgets: DynamicOverviewWidget[] = overviewWidgets.map((widget) => ({
    id: pluginOverviewWidgetId(widget.pluginId, widget.id),
    region: widget.region,
    defaultVisible: widget.defaultVisible,
  }))
  const contributions = new Map<string, RegisteredPluginOverviewWidget>()
  for (const widget of overviewWidgets) {
    contributions.set(pluginOverviewWidgetId(widget.pluginId, widget.id), widget)
  }
  const meta = (id: OverviewWidgetId): OverviewWidgetMeta | undefined => {
    const widget = contributions.get(id)
    if (!widget) return undefined
    return {
      title: widget.titleKey
        ? host.i18n.translate(widget.pluginId, widget.titleKey, locale)
        : widget.title,
      description: widget.descriptionKey
        ? host.i18n.translate(widget.pluginId, widget.descriptionKey, locale)
        : widget.description,
      icon: widget.icon,
      region: widget.region,
    }
  }
  return { meta, dynamicWidgets, contributions }
}

function SortablePreview({
  id,
  title,
  description,
  icon: Icon,
  first,
  last,
  onMove,
  onHide,
}: {
  id: OverviewWidgetId
  title: string
  description: string
  icon: WidgetIcon
  first: boolean
  last: boolean
  onMove: (direction: -1 | 1) => void
  onHide: () => void
}) {
  const { t } = useTranslation()
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
          <p className="text-xs text-muted-foreground">{t("overviewLayout.preview")}</p>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-1">
          <Button
            ref={setActivatorNodeRef}
            variant="ghost"
            size="icon-lg"
            className="cursor-grab touch-none active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={t("overviewLayout.drag", { title })}
          >
            <GripVertical />
          </Button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-lg"
              disabled={first}
              onClick={() => onMove(-1)}
              aria-label={t("overviewLayout.moveUp", { title })}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              disabled={last}
              onClick={() => onMove(1)}
              aria-label={t("overviewLayout.moveDown", { title })}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              onClick={onHide}
              aria-label={t("overviewLayout.hide", { title })}
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
  onMove,
  onHide,
}: {
  region: OverviewRegion
  layout: OverviewLayout
  onMove: (active: OverviewWidgetId, target: OverviewWidgetId) => void
  onHide: (id: OverviewWidgetId) => void
}) {
  const { t } = useTranslation()
  const { meta } = useOverviewWidgetMeta()
  const contextId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const items = layout.items.flatMap((item) => {
    if (!item.visible) return []
    const widget = meta(item.id)
    return widget?.region === region ? [{ id: item.id, ...widget }] : []
  })
  const titleFor = (id: string | number) => (isOverviewWidgetId(id) ? (meta(id)?.title ?? "") : "")

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`${contextId}-title`}>
      <h2 id={`${contextId}-title`} className="text-sm font-medium">
        {t(`overviewLayout.${region}`)}
      </h2>
      <DndContext
        id={contextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: { draggable: t("overviewLayout.keyboardInstructions") },
          announcements: {
            onDragStart: ({ active }) =>
              t("overviewLayout.dragStart", { title: titleFor(active.id) }),
            onDragOver: ({ active, over }) =>
              over
                ? t("overviewLayout.dragOver", {
                    title: titleFor(active.id),
                    target: titleFor(over.id),
                  })
                : t("overviewLayout.dragStart", { title: titleFor(active.id) }),
            onDragEnd: ({ active }) => t("overviewLayout.dragEnd", { title: titleFor(active.id) }),
            onDragCancel: ({ active }) =>
              t("overviewLayout.dragCancel", { title: titleFor(active.id) }),
          },
        }}
        onDragEnd={({ active, over }) => {
          if (over && isOverviewWidgetId(active.id) && isOverviewWidgetId(over.id))
            onMove(active.id, over.id)
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
            <EmptyTitle>{t("overviewLayout.regionEmpty")}</EmptyTitle>
            <EmptyDescription>{t("overviewLayout.regionEmptyDescription")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

function AddLibrary({
  layout,
  onAdd,
}: {
  layout: OverviewLayout
  onAdd: (id: OverviewWidgetId) => void
}) {
  const { t } = useTranslation()
  const { meta } = useOverviewWidgetMeta()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const hidden = layout.items.flatMap((item) => {
    if (item.visible) return []
    const widget = meta(item.id)
    return widget ? [{ id: item.id, ...widget }] : []
  })
  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
      {(["summary", "content"] as const).map((region) => {
        const items = hidden.filter((item) => item.region === region)
        return (
          <section
            key={region}
            className="flex flex-col gap-3"
            aria-label={t(`overviewLayout.${region}`)}
          >
            <h3 className="text-sm font-medium">{t(`overviewLayout.${region}`)}</h3>
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("overviewLayout.allAdded")}</p>
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
                    <span className="text-xs text-muted-foreground">
                      {t("overviewLayout.preview")}
                    </span>
                    <Button
                      variant="outline"
                      onClick={() => onAdd(id)}
                      aria-label={t("overviewLayout.addWidget", { title })}
                    >
                      <Plus data-icon="inline-start" />
                      {t("overviewLayout.add")}
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
      {t("overviewLayout.addWidgets")}
    </Button>
  )
  const close = (
    <Button variant="outline" onClick={() => setOpen(false)}>
      {t("overviewLayout.done")}
    </Button>
  )

  return isMobile ? (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t("overviewLayout.addWidgets")}</DrawerTitle>
          <DrawerDescription>{t("overviewLayout.libraryDescription")}</DrawerDescription>
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
          <SheetTitle>{t("overviewLayout.addWidgets")}</SheetTitle>
          <SheetDescription>{t("overviewLayout.libraryDescription")}</SheetDescription>
        </SheetHeader>
        {content}
        <SheetFooter>{close}</SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function useLayoutHydrated() {
  return useSyncExternalStore(
    useSettingsStore.subscribe,
    () => useSettingsStore.getState().hasHydrated,
    () => false
  )
}

function LayoutSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3" role="status" aria-label={t("overviewLayout.loading")}>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

export function OverviewEditor() {
  const hydrated = useLayoutHydrated()
  const layout = useSettingsStore((state) => state.overviewLayout)
  return hydrated ? <LayoutEditor initialLayout={layout} /> : <LayoutSkeleton />
}

function LayoutEditor({ initialLayout }: { initialLayout: OverviewLayout }) {
  const { t } = useTranslation()
  const router = useRouter()
  const setLayout = useSettingsStore((state) => state.setOverviewLayout)
  const { dynamicWidgets } = useOverviewWidgetMeta()
  const [draft, setDraft] = useState(() => normalizeOverviewLayout(initialLayout, dynamicWidgets))
  const dynamicSignature = dynamicWidgets
    .map((widget) => `${widget.id}:${widget.region}:${widget.defaultVisible}`)
    .join("|")

  useEffect(() => {
    // Plugins can be enabled or disabled while the editor is open; reconcile the draft
    // without dropping saved slots for contributions that are currently absent.
    setDraft((current) => normalizeOverviewLayout(current, dynamicWidgets))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the contribution signature
  }, [dynamicSignature])

  function setVisibility(id: OverviewWidgetId, visible: boolean) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, visible } : item)),
    }))
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t("overviewLayout.editDescription")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => {
              setLayout(draft)
              router.push("/dashboard/plugin?route=overview")
            }}
          >
            <Check data-icon="inline-start" />
            {t("overviewLayout.save")}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/me/settings")}>
            {t("overviewLayout.cancel")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setDraft(createDefaultOverviewLayout(dynamicWidgets))}
          >
            <RotateCcw data-icon="inline-start" />
            {t("overviewLayout.reset")}
          </Button>
          <AddLibrary layout={draft} onAdd={(id) => setVisibility(id, true)} />
        </div>
      </header>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4" aria-hidden="true" />
            {t("overviewLayout.profile")}
          </CardTitle>
          <CardDescription>{t("overviewLayout.profileDescription")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            variant="outline"
            aria-pressed={draft.profileVisible}
            onClick={() => setDraft({ ...draft, profileVisible: !draft.profileVisible })}
          >
            {draft.profileVisible ? (
              <Eye data-icon="inline-start" />
            ) : (
              <EyeOff data-icon="inline-start" />
            )}
            {t(
              draft.profileVisible ? "overviewLayout.profileShown" : "overviewLayout.profileHidden"
            )}
          </Button>
        </CardFooter>
      </Card>
      {(["summary", "content"] as const).map((region) => (
        <EditableRegion
          key={region}
          region={region}
          layout={draft}
          onMove={(active, target) =>
            setDraft((current) => moveOverviewWidget(current, active, target, dynamicWidgets))
          }
          onHide={(id) => setVisibility(id, false)}
        />
      ))}
    </div>
  )
}

export function OverviewComposer({
  renderProfile,
}: {
  renderProfile?: (compact: boolean, summaries?: ReactNode) => ReactNode
}) {
  const { t } = useTranslation()
  const hydrated = useLayoutHydrated()
  const compact = useIsMobile()
  const layout = useSettingsStore((state) => state.overviewLayout)
  const setLayout = useSettingsStore((state) => state.setOverviewLayout)
  const { meta, dynamicWidgets, contributions } = useOverviewWidgetMeta()
  if (!hydrated) return <LayoutSkeleton />

  // Reconcile installed plugin contributions so a widget the user has never arranged
  // still honours its declared default visibility.
  const effective = normalizeOverviewLayout(layout, dynamicWidgets)
  const summary: { id: OverviewWidgetId; node: ReactNode }[] = []
  const content: { id: OverviewWidgetId; title: string; node: ReactNode }[] = []
  for (const item of effective.items) {
    if (!item.visible) continue
    // An uninstalled plugin (or an unmigrated legacy ID) keeps its saved slot but has
    // nothing to render right now.
    const contribution = contributions.get(item.id)
    if (!contribution) continue
    const Component = contribution.component
    const node = <Component />
    if (contribution.region === "summary") {
      summary.push({ id: item.id, node })
    } else {
      content.push({ id: item.id, title: meta(item.id)?.title ?? contribution.title, node })
    }
  }
  const showFallback = !layout.profileVisible && summary.length === 0
  const inlineSummaries =
    summary.length > 0 ? (
      <CardContent
        data-overview-inline
        className={cn("grid gap-x-3 gap-y-4", layout.profileVisible && "border-t pt-3")}
        style={{ gridTemplateColumns: `repeat(${Math.min(3, summary.length)}, minmax(0, 1fr))` }}
      >
        {summary.map(({ id, node }) => (
          <div key={id} data-overview-widget={id} className="min-w-0">
            {node}
          </div>
        ))}
      </CardContent>
    ) : null

  return (
    <div data-overview-root className="flex min-w-0 flex-col gap-4">
      {compact
        ? layout.profileVisible && renderProfile
          ? renderProfile(true, inlineSummaries)
          : inlineSummaries && <Card>{inlineSummaries}</Card>
        : ((layout.profileVisible && renderProfile) || summary.length > 0) && (
            <div
              className={cn(
                "grid gap-4",
                layout.profileVisible &&
                  renderProfile &&
                  summary.length > 0 &&
                  "lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]"
              )}
            >
              {layout.profileVisible && renderProfile && (
                <div className="min-w-0 [&>*]:h-full">{renderProfile(false)}</div>
              )}
              {summary.length > 0 && (
                <div
                  className="grid grid-cols-2 gap-3 xl:grid-cols-[repeat(var(--summary-columns),minmax(0,1fr))]"
                  style={
                    {
                      "--summary-columns": summary.length === 4 ? 2 : summary.length,
                    } as CSSProperties
                  }
                >
                  {summary.map(({ id, node }, index) => {
                    const oddLast = summary.length % 2 === 1 && index === summary.length - 1
                    return (
                      <div
                        key={id}
                        data-overview-widget={id}
                        className={cn(
                          "min-w-0 [&>*]:h-full",
                          oddLast && "col-span-2 xl:col-span-1"
                        )}
                      >
                        {node}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
      {content.length > 0 && (
        <div data-overview-content className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {content.map(({ id, title, node }) => {
            // A contribution renders its own Card; `[data-overview-wide]` opts into the
            // full row, and a widget with nothing to show collapses instead of leaving a gap.
            return (
              <section
                key={id}
                aria-label={title}
                data-overview-widget={id}
                className="min-w-0 empty:hidden has-[>[data-overview-wide]]:xl:col-span-2"
              >
                {node}
              </section>
            )
          })}
        </div>
      )}
      {showFallback && (
        <div data-overview-fallback>
          <Empty className="border py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>{t("overviewLayout.empty")}</EmptyTitle>
              <EmptyDescription>{t("overviewLayout.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href="/dashboard/me/settings">{t("settings.title")}</Link>
              </Button>
              <Button
                variant="outline"
                onClick={() => setLayout(createDefaultOverviewLayout(dynamicWidgets))}
              >
                <RotateCcw data-icon="inline-start" />
                {t("overviewLayout.reset")}
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
    </div>
  )
}
