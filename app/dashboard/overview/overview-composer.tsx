"use client"

import { useId, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react"
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
  BookOpen,
  CalendarDays,
  CalendarRange,
  Check,
  ClipboardCheck,
  CreditCard,
  Eye,
  EyeOff,
  GraduationCap,
  GripVertical,
  LayoutDashboard,
  ListChecks,
  Plus,
  RotateCcw,
  UserRound,
} from "lucide-react"
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
import { useSettingsStore } from "@/lib/stores/settings"
import { cn } from "@/lib/utils"
import {
  createDefaultOverviewLayout,
  isOverviewWidgetId,
  moveOverviewWidget,
  normalizeOverviewLayout,
  OVERVIEW_WIDGETS,
  type ContentWidgetId,
  type OverviewLayout,
  type OverviewRegion,
  type OverviewWidgetId,
  type SummaryWidgetId,
} from "./layout-config"

const WIDGET_ICONS = {
  week: CalendarDays,
  ecard: CreditCard,
  gpa: GraduationCap,
  evaluation: ClipboardCheck,
  "course-progress": BookOpen,
  "today-courses": CalendarRange,
  "upcoming-exams": GraduationCap,
  "evaluation-tasks": ListChecks,
} as const

function SortablePreview({
  id,
  first,
  last,
  onMove,
  onHide,
}: {
  id: OverviewWidgetId
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
  const widget = OVERVIEW_WIDGETS[id]
  const Icon = WIDGET_ICONS[id]
  const title = t(widget.titleKey)

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
          <CardDescription>{t(widget.descriptionKey)}</CardDescription>
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
  const contextId = useId()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const items = layout.items.filter(
    (item) => item.visible && OVERVIEW_WIDGETS[item.id].region === region
  )
  const titleFor = (id: string | number) =>
    isOverviewWidgetId(id) ? t(OVERVIEW_WIDGETS[id].titleKey) : ""

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
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const hidden = layout.items.filter((item) => !item.visible)
  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-4">
      {(["summary", "content"] as const).map((region) => {
        const items = hidden.filter((item) => OVERVIEW_WIDGETS[item.id].region === region)
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
              items.map(({ id }) => {
                const widget = OVERVIEW_WIDGETS[id]
                const Icon = WIDGET_ICONS[id]
                const title = t(widget.titleKey)
                return (
                  <Card key={id} size="sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Icon className="size-4" aria-hidden="true" />
                        {title}
                      </CardTitle>
                      <CardDescription>{t(widget.descriptionKey)}</CardDescription>
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
                )
              })
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
  const [draft, setDraft] = useState(() => normalizeOverviewLayout(initialLayout))

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
              router.push("/dashboard")
            }}
          >
            <Check data-icon="inline-start" />
            {t("overviewLayout.save")}
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/me/settings")}>
            {t("overviewLayout.cancel")}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(createDefaultOverviewLayout())}>
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
            setDraft((current) => moveOverviewWidget(current, active, target))
          }
          onHide={(id) => setVisibility(id, false)}
        />
      ))}
    </div>
  )
}

export function OverviewComposer({
  renderProfile,
  renderSummary,
  renderContent,
}: {
  renderProfile: (compact: boolean, summaries?: ReactNode) => ReactNode
  renderSummary: (id: SummaryWidgetId, compact: boolean) => ReactNode
  renderContent: (id: ContentWidgetId) => ReactNode
}) {
  const { t } = useTranslation()
  const hydrated = useLayoutHydrated()
  const compact = useIsMobile()
  const layout = useSettingsStore((state) => state.overviewLayout)
  const setLayout = useSettingsStore((state) => state.setOverviewLayout)
  if (!hydrated) return <LayoutSkeleton />

  const summary: { id: SummaryWidgetId; node: ReactNode }[] = []
  const content: { id: ContentWidgetId; node: ReactNode }[] = []
  for (const item of layout.items) {
    if (!item.visible) continue
    if (OVERVIEW_WIDGETS[item.id].region === "summary") {
      const id = item.id as SummaryWidgetId
      const node = renderSummary(id, compact)
      if (node != null && typeof node !== "boolean") summary.push({ id, node })
    } else {
      const id = item.id as ContentWidgetId
      const node = renderContent(id)
      if (node != null && typeof node !== "boolean") content.push({ id, node })
    }
  }
  const empty = !layout.profileVisible && summary.length === 0 && content.length === 0
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
    <div className="flex min-w-0 flex-col gap-4">
      {compact
        ? layout.profileVisible
          ? renderProfile(true, inlineSummaries)
          : inlineSummaries && <Card>{inlineSummaries}</Card>
        : (layout.profileVisible || summary.length > 0) && (
            <div
              className={cn(
                "grid gap-4",
                layout.profileVisible &&
                  summary.length > 0 &&
                  "lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]"
              )}
            >
              {layout.profileVisible && (
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
                  {summary.map(({ id, node }, index) => (
                    <Card
                      key={id}
                      size="sm"
                      data-overview-widget={id}
                      className={cn(
                        "min-w-0",
                        summary.length % 2 === 1 &&
                          index === summary.length - 1 &&
                          "col-span-2 xl:col-span-1"
                      )}
                    >
                      {node}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
      {content.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {content.map(({ id, node }) => (
            <section
              key={id}
              aria-label={t(OVERVIEW_WIDGETS[id].titleKey)}
              data-overview-widget={id}
              className={cn(
                "min-w-0",
                (id === "course-progress" || id === "evaluation-tasks") && "xl:col-span-2"
              )}
            >
              {node}
            </section>
          ))}
        </div>
      )}
      {empty && (
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
            <Button variant="outline" onClick={() => setLayout(createDefaultOverviewLayout())}>
              <RotateCcw data-icon="inline-start" />
              {t("overviewLayout.reset")}
            </Button>
          </EmptyContent>
        </Empty>
      )}
    </div>
  )
}
