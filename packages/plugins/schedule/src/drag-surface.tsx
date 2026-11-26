import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  scheduleOccurrence,
  type ScheduleDrop,
  type ScheduleEditorState,
  type ScheduleOccurrence,
  type SchedulePatch,
  type ScheduleSelection,
  type ScheduleTrace,
} from "@orahako/academic-kit"
import type { Translator } from "@orahako/sdk"
import { BACK_PRIORITY, cn, useBackHandler } from "@orahako/ui-primitives"
import type { ScheduleDictionary } from "./dictionary"

export interface ScheduleDragSurfaceProps {
  readonly enabled: boolean
  readonly editing: boolean
  readonly patches: readonly SchedulePatch[]
  readonly selectedWeek: number
  readonly totalWeeks: number
  readonly termStartDate: string
  readonly courses: readonly ScheduleOccurrence[]
  readonly traces: readonly ScheduleTrace[]
  readonly t: Translator<ScheduleDictionary>
  readonly onShiftWeek: (delta: number) => void
  readonly onDrop: (drop: ScheduleDrop) => void
  readonly onSelect: (selection: ScheduleSelection) => void
  readonly onTraceClick: (patchId: string) => void
  readonly children: (editor: ScheduleEditorState) => ReactNode
}

interface Gesture {
  selection: ScheduleSelection
  touchId: number | null
  originX: number
  originY: number
  x: number
  y: number
  active: boolean
  moved: boolean
  edge: number
  edgeAt: number
}

const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>()
const DRAG_ACTIVATION_PX = 6

export function ScheduleDragSurface(props: ScheduleDragSurfaceProps): ReactNode {
  const { t } = props
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  }, [props])

  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
  const syncVisualRef = useRef<((navigate: boolean) => void) | null>(null)
  const [hasGesture, setHasGesture] = useState(false)
  const suppressClickUntil = useRef(0)
  const overlay = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ScheduleSelection | null>(null)
  const [targetLabel, setTargetLabel] = useState<{
    readonly date: string
    readonly section: number
    readonly valid: boolean
  } | null>(null)
  const [edgeDirection, setEdgeDirection] = useState(0)

  useBackHandler(
    () => cancelGesture.current?.(),
    props.enabled && hasGesture,
    BACK_PRIORITY.gesture
  )

  useEffect(() => {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return
    }
    const onClick = (event: MouseEvent): void => {
      if (Date.now() < suppressClickUntil.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener("click", onClick, true)
    return () => document.removeEventListener("click", onClick, true)
  }, [])

  // Position the newly mounted floating ghost & drop preview synchronously before paint.
  useLayoutEffect(() => {
    if (active) {
      syncVisualRef.current?.(false)
    }
  }, [active])

  useEffect(() => {
    if (!props.enabled) return
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return
    }

    let frame = 0
    let destination: ScheduleDrop | null = null
    let labelKey = ""
    let touchTarget: Element | null = null

    function positionOverlay(g: Gesture): void {
      const node = overlay.current
      if (!node || typeof window === "undefined") return
      const left = Math.max(8, Math.min(g.x + 12, window.innerWidth - 204))
      const top = Math.max(8, Math.min(g.y - 56, window.innerHeight - 96))
      node.style.transform = `translate3d(${left}px, ${top}px, 0)`
    }

    function finish(commit: boolean): void {
      const g = gesture.current
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame)
      }
      if (touchTarget) {
        touchTarget.removeEventListener("touchmove", move, true)
        touchTarget.removeEventListener("touchend", end, true)
        touchTarget.removeEventListener("touchcancel", cancel, true)
        touchTarget = null
      }
      gesture.current = null
      setHasGesture(false)
      if (!g?.active) return
      suppressClickUntil.current = Date.now() + 450
      const drop = destination
      destination = null
      setActive(null)
      setTargetLabel(null)
      setEdgeDirection(0)
      labelKey = ""
      if (commit && drop && latest.current.enabled) {
        latest.current.onDrop(drop)
      }
    }

    function update(navigate: boolean): void {
      const g = gesture.current
      const host = root.current
      if (!g?.active || !host) return
      positionOverlay(g)
      const { selectedWeek, totalWeeks } = latest.current
      const grid = Array.from(
        host.querySelectorAll<HTMLElement>(`[data-schedule-grid="${selectedWeek}"]`)
      ).find((el) => el.getBoundingClientRect().width > 0)
      destination = null
      if (preview.current) preview.current.style.display = "none"
      if (!grid) return

      const gridRect = grid.getBoundingClientRect()
      const hostRect = host.getBoundingClientRect()
      const left = Math.max(0, hostRect.left)
      const right = Math.min(window.innerWidth, hostRect.right)
      const withinY =
        g.y >= Math.max(0, gridRect.top) && g.y <= Math.min(window.innerHeight, gridRect.bottom)
      if (navigate) {
        const rawEdge =
          g.moved && withinY && g.x >= left - 16 && g.x < left + 30
            ? -1
            : g.moved && withinY && g.x > right - 30 && g.x <= right + 16
              ? 1
              : 0
        const edge =
          selectedWeek + rawEdge >= 1 && selectedWeek + rawEdge <= totalWeeks ? rawEdge : 0
        const now = performance.now()
        if (edge !== g.edge) {
          g.edge = edge
          g.edgeAt = now
          setEdgeDirection(edge)
        }
        if (edge && now - g.edgeAt >= 600) {
          g.edgeAt = now + 250
          if (selectedWeek + edge >= 1 && selectedWeek + edge <= totalWeeks) {
            latest.current.onShiftWeek(edge)
          }
        }
        let scrollParent: HTMLElement | null = grid.parentElement
        while (
          scrollParent &&
          !(
            scrollParent.scrollHeight > scrollParent.clientHeight &&
            /auto|scroll/.test(getComputedStyle(scrollParent).overflowY)
          )
        ) {
          scrollParent = scrollParent.parentElement
        }
        const scrollRect = scrollParent?.getBoundingClientRect()
        const top = Math.max(0, scrollRect?.top ?? 0)
        const bottom = Math.min(window.innerHeight, scrollRect?.bottom ?? window.innerHeight)
        if (g.x >= left && g.x <= right) {
          const dy = g.y < top + 48 ? -10 : g.y > bottom - 48 ? 10 : 0
          if (dy) (scrollParent ?? document.scrollingElement)?.scrollBy(0, dy)
        }
      }

      const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-schedule-section]"))
      const column = cells.filter((cell) => {
        const r = cell.getBoundingClientRect()
        return g.x >= r.left && g.x < r.right
      })
      if (column.length && withinY) {
        const nearest = column.reduce((a, b) => {
          const ar = a.getBoundingClientRect()
          const br = b.getBoundingClientRect()
          const distance = (r: DOMRect) =>
            g.y < r.top ? r.top - g.y : g.y > r.bottom ? g.y - r.bottom : 0
          return distance(ar) <= distance(br) ? a : b
        })
        const date = nearest.dataset.scheduleDate ?? ""
        const start = g.selection.kind === "day" ? 1 : Number(nearest.dataset.scheduleSection)
        const course = g.selection.courses[0]
        const lastColumnCell = column[column.length - 1]
        const end =
          g.selection.kind === "day"
            ? Number(lastColumnCell?.dataset.scheduleSection ?? 0)
            : start + (course ? course.endSection - course.startSection : 0)
        const first = g.selection.kind === "day" ? (column[0] ?? nearest) : nearest
        const last = column.find((cell) => Number(cell.dataset.scheduleSection) === end)
        const sourceNoop =
          date === g.selection.date &&
          (g.selection.kind === "day" || start === course?.startSection)
        const sections = new Set(column.map((cell) => Number(cell.dataset.scheduleSection)))
        const spans =
          g.selection.kind === "day"
            ? g.selection.courses.map((item) => [item.startSection, item.endSection] as const)
            : ([[start, end]] as const)
        const complete = spans.every(([spanStart, spanEnd]) => {
          for (let section = spanStart; section <= spanEnd; section += 1) {
            if (!sections.has(section)) return false
          }
          return true
        })
        const valid = Boolean(date) && Boolean(last) && complete && !sourceNoop
        if (valid) {
          destination = { selection: g.selection, targetDate: date, targetStartSection: start }
        }
        if (preview.current) {
          const a = first.getBoundingClientRect()
          const b = (last ?? first).getBoundingClientRect()
          Object.assign(preview.current.style, {
            display: "block",
            left: `${a.left}px`,
            top: `${a.top}px`,
            width: `${a.width}px`,
            height: `${b.bottom - a.top}px`,
            borderColor: valid ? "var(--primary)" : "var(--destructive)",
            background: valid
              ? "color-mix(in srgb, var(--primary) 16%, transparent)"
              : "color-mix(in srgb, var(--destructive) 12%, transparent)",
          })
        }
        const key = `${date}:${start}:${valid}`
        if (key !== labelKey) {
          labelKey = key
          setTargetLabel({ date, section: start, valid })
        }
      } else if (labelKey) {
        labelKey = ""
        setTargetLabel(null)
      }
    }

    function animate(): void {
      update(true)
      if (gesture.current?.active && typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(animate)
      }
    }

    function activate(): void {
      const g = gesture.current
      if (!g || g.active || !latest.current.enabled) return
      g.active = true
      setActive(g.selection)
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(animate)
      }
    }

    function isTouchEvt(event: Event): event is TouchEvent {
      return typeof TouchEvent !== "undefined" && event instanceof TouchEvent
    }

    function isMouseEvt(event: Event): event is MouseEvent {
      return typeof MouseEvent !== "undefined" && event instanceof MouseEvent
    }

    function begin(event: MouseEvent | TouchEvent): void {
      if (!latest.current.enabled || !(event.target instanceof Element)) return
      const isTouch = isTouchEvt(event)
      if (isTouch && event.touches.length !== 1) {
        finish(false)
        return
      }
      if (gesture.current || (!isTouch && event.button !== 0)) return
      const source = event.target.closest<HTMLElement>(
        "[data-schedule-course], [data-schedule-day]"
      )
      if (!source || !root.current?.contains(source)) return
      const { courses } = latest.current
      const course = courses.find((c) => c.occurrenceId === source.dataset.scheduleCourse)
      const date = source.dataset.scheduleDay ?? course?.date
      if (!date) return
      const selection: ScheduleSelection = source.dataset.scheduleDay
        ? { kind: "day", date, courses: courses.filter((c) => c.date === date) }
        : course
          ? { kind: "course", date, courses: [course] }
          : { kind: "course", date, courses: [] }
      if (!selection.courses.length) return
      const touch = isTouch ? (event.touches[0] ?? null) : null
      const x = isTouch ? (touch?.clientX ?? 0) : event.clientX
      const y = isTouch ? (touch?.clientY ?? 0) : event.clientY
      gesture.current = {
        selection,
        touchId: touch?.identifier ?? null,
        originX: x,
        originY: y,
        x,
        y,
        active: false,
        moved: false,
        edge: 0,
        edgeAt: 0,
      }
      setHasGesture(true)
      if (touch) {
        // Touch events stay targeted on the initial element even if the week switches mid-drag.
        touchTarget = event.target
        touchTarget.addEventListener("touchmove", move, { capture: true, passive: false })
        touchTarget.addEventListener("touchend", end, { capture: true, passive: false })
        touchTarget.addEventListener("touchcancel", cancel, true)
      }
    }

    function move(event: Event): void {
      const isTouch = isTouchEvt(event)
      const isMouse = isMouseEvt(event)
      if (!isTouch && !isMouse) return
      const g = gesture.current
      if (!g) return
      if (isTouch !== (g.touchId !== null)) return
      if (isTouch && event.touches.length !== 1) {
        finish(false)
        return
      }
      const point = isTouch
        ? Array.from(event.touches).find((touch) => touch.identifier === g.touchId)
        : isMouse
          ? event
          : undefined
      if (!point) {
        finish(false)
        return
      }
      g.x = point.clientX
      g.y = point.clientY
      const distance = Math.hypot(g.x - g.originX, g.y - g.originY)
      if (distance >= DRAG_ACTIVATION_PX) {
        g.moved = true
        if (!g.active) activate()
      }
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
        positionOverlay(g)
      }
    }

    function end(event: Event): void {
      const isTouch = isTouchEvt(event)
      const isMouse = isMouseEvt(event)
      if (!isTouch && !isMouse) return
      const g = gesture.current
      if (!g || isTouch !== (g.touchId !== null)) return
      if (isTouch && event.touches.length > 0) {
        finish(false)
        return
      }
      const point = isTouch
        ? Array.from(event.changedTouches).find((touch) => touch.identifier === g.touchId)
        : isMouse
          ? event
          : undefined
      if (point) {
        g.x = point.clientX
        g.y = point.clientY
      }
      if (Math.hypot(g.x - g.originX, g.y - g.originY) >= DRAG_ACTIVATION_PX) {
        g.moved = true
      }
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame)
        }
        update(false)
      }
      finish(true)
    }

    function cancel(): void {
      finish(false)
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault()
        cancel()
      }
    }

    function onScroll(): void {
      if (gesture.current && !gesture.current.active) cancel()
    }

    function onContextMenu(event: Event): void {
      if (gesture.current) event.preventDefault()
    }

    cancelGesture.current = cancel
    syncVisualRef.current = update
    document.addEventListener("mousedown", begin, true)
    document.addEventListener("touchstart", begin, { capture: true, passive: true })
    document.addEventListener("mousemove", move, true)
    document.addEventListener("mouseup", end, true)
    document.addEventListener("keydown", onKeyDown, true)
    document.addEventListener("contextmenu", onContextMenu, true)
    document.addEventListener("scroll", onScroll, true)
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("blur", cancel)
    }
    return () => {
      cancel()
      cancelGesture.current = null
      syncVisualRef.current = null
      document.removeEventListener("mousedown", begin, true)
      document.removeEventListener("touchstart", begin, true)
      document.removeEventListener("mousemove", move, true)
      document.removeEventListener("mouseup", end, true)
      document.removeEventListener("keydown", onKeyDown, true)
      document.removeEventListener("contextmenu", onContextMenu, true)
      document.removeEventListener("scroll", onScroll, true)
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("blur", cancel)
      }
    }
  }, [props.enabled])

  const markers = useMemo(() => {
    const appliedIds = new Set(props.traces.map((trace) => trace.patchId))
    const coursePatchIds = new Set(
      props.patches
        .filter((patch) => patch.enabled && patch.kind === "course")
        .map((patch) => patch.id)
    )
    const adjustedCourses = new Set<string>()
    for (const course of props.courses) {
      for (const id of course.patchIds) {
        appliedIds.add(id)
      }
      const lastPatchId = course.patchIds.at(-1)
      if (lastPatchId && coursePatchIds.has(lastPatchId)) {
        adjustedCourses.add(course.occurrenceId)
      }
    }
    const adjustedDates = new Set<string>()
    for (const patch of props.patches) {
      if (!patch.enabled || patch.kind !== "day" || !appliedIds.has(patch.id)) continue
      if (patch.mode !== "copy") adjustedDates.add(patch.sourceDate)
      if (patch.mode !== "clear") adjustedDates.add(patch.targetDate)
    }
    return { adjustedDates, adjustedCourses, coursePatchIds }
  }, [props.patches, props.courses, props.traces])

  const draggingOccurrenceIds = useMemo<ReadonlySet<string>>(
    () =>
      active ? new Set(active.courses.map((course) => course.occurrenceId)) : EMPTY_STRING_SET,
    [active]
  )
  const draggingDate = active?.kind === "day" ? active.date : null

  const isDragging = useCallback(() => active !== null, [active])

  const { enabled: editorEnabled, courses: editorCourses, onSelect: onSelectItem } = props

  const selectCourse = useCallback(
    (course: Parameters<NonNullable<ScheduleEditorState["selectCourse"]>>[0]): boolean => {
      const occurrence = scheduleOccurrence(course)
      if (!editorEnabled || !occurrence) return false
      onSelectItem({ kind: "course", date: occurrence.date, courses: [occurrence] })
      return true
    },
    [editorEnabled, onSelectItem]
  )

  const selectDay = useCallback(
    (date: string): void => {
      if (!editorEnabled) return
      onSelectItem({
        kind: "day",
        date,
        courses: editorCourses.filter((c) => c.date === date),
      })
    },
    [editorCourses, editorEnabled, onSelectItem]
  )

  const editor = useMemo<ScheduleEditorState>(
    () => ({
      enabled: props.enabled,
      editing: props.editing,
      ...markers,
      termStartDate: props.termStartDate,
      courses: props.courses,
      traces: props.traces,
      draggingOccurrenceIds,
      draggingDate,
      isDragging,
      selectCourse,
      selectDay,
      onTraceClick: props.onTraceClick,
    }),
    [
      draggingDate,
      draggingOccurrenceIds,
      isDragging,
      markers,
      props.courses,
      props.editing,
      props.enabled,
      props.onTraceClick,
      props.termStartDate,
      props.traces,
      selectCourse,
      selectDay,
    ]
  )

  const dragVisuals = active ? (
    <>
      <div
        ref={preview}
        style={{ display: "none" }}
        className="pointer-events-none fixed z-50 rounded-md border-2 border-dashed shadow-sm"
      />
      <div
        ref={overlay}
        className="pointer-events-none fixed top-0 left-0 z-50 flex w-48 flex-col gap-1 rounded-lg border border-primary/40 bg-popover/95 p-2.5 text-sm text-popover-foreground shadow-xl backdrop-blur-sm"
      >
        <span className="truncate font-medium">
          {active.kind === "day"
            ? t("scheduleEditor.draggingDay", { count: active.courses.length })
            : t("scheduleEditor.draggingCourse", { name: active.courses[0]?.name ?? "" })}
        </span>
        {edgeDirection !== 0 && (
          <span
            className="flex items-center gap-1 text-xs font-semibold text-primary"
            role="status"
          >
            {edgeDirection < 0 ? (
              <ChevronLeft className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            {t(edgeDirection < 0 ? "scheduleEditor.edgePrevious" : "scheduleEditor.edgeNext")}
          </span>
        )}
        <span className="text-xs text-muted-foreground" role="status">
          {targetLabel?.valid
            ? t("scheduleEditor.dropTarget", {
                date: targetLabel.date,
                section: targetLabel.section,
              })
            : t("scheduleEditor.invalidDrop")}
        </span>
      </div>
    </>
  ) : null

  return (
    <>
      <div
        ref={root}
        className={cn("flex min-h-0 flex-1 flex-col", props.editing && "select-none")}
        data-schedule-editing={props.editing || undefined}
        inert={props.editing && !props.enabled}
      >
        {props.children(editor)}
      </div>
      {dragVisuals &&
        (typeof document !== "undefined" && document.body
          ? createPortal(dragVisuals, document.body)
          : dragVisuals)}
    </>
  )
}
