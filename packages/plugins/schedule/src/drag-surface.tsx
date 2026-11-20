import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
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
import { BACK_PRIORITY, Button, cn, useBackHandler } from "@orahako/ui-primitives"
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

export function ScheduleDragSurface(props: ScheduleDragSurfaceProps): ReactNode {
  const { t } = props
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  }, [props])

  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
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

  useEffect(() => {
    if (!props.enabled) return
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let destination: ScheduleDrop | null = null
    let labelKey = ""
    let touchTarget: Element | null = null

    function finish(commit: boolean): void {
      const g = gesture.current
      clearTimeout(timer)
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
      if (overlay.current) {
        overlay.current.style.transform = `translate3d(${Math.min(g.x + 12, window.innerWidth - 188)}px, ${Math.max(8, g.y - 60)}px, 0)`
      }
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
              ? "color-mix(in srgb, var(--primary) 15%, transparent)"
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
      if (!g || !latest.current.enabled) return
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
        touchTarget = event.target
        touchTarget.addEventListener("touchmove", move, { capture: true, passive: false })
        touchTarget.addEventListener("touchend", end, { capture: true, passive: false })
        touchTarget.addEventListener("touchcancel", cancel, true)
      }
      if (touch && source.dataset.scheduleDay) {
        activate()
        event.stopPropagation()
      } else if (touch) {
        timer = setTimeout(activate, 400)
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
      if (Math.hypot(g.x - g.originX, g.y - g.originY) >= 5) g.moved = true
      if (!g.active) {
        const distance = Math.hypot(g.x - g.originX, g.y - g.originY)
        if (isTouch && distance > 8) {
          finish(false)
          return
        }
        if (!isTouch && distance >= 5) activate()
      }
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
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
      if (Math.hypot(g.x - g.originX, g.y - g.originY) >= 5) g.moved = true
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(frame)
        }
        update(false)
      }
      const dayTap = g.active && g.touchId !== null && g.selection.kind === "day" && !g.moved
      finish(!dayTap)
      if (dayTap && latest.current.enabled) {
        latest.current.onSelect(g.selection)
      }
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

  const isDragging = useCallback(() => active !== null, [active])

  const selectCourse = useCallback(
    (course: Parameters<NonNullable<ScheduleEditorState["selectCourse"]>>[0]): boolean => {
      const occurrence = scheduleOccurrence(course)
      if (!props.enabled || !occurrence) return false
      props.onSelect({ kind: "course", date: occurrence.date, courses: [occurrence] })
      return true
    },
    [props]
  )

  const selectDay = useCallback(
    (date: string): void => {
      if (!props.enabled) return
      props.onSelect({
        kind: "day",
        date,
        courses: props.courses.filter((c) => c.date === date),
      })
    },
    [props]
  )

  const editor = useMemo<ScheduleEditorState>(
    () => ({
      enabled: props.enabled,
      editing: props.editing,
      ...markers,
      termStartDate: props.termStartDate,
      courses: props.courses,
      traces: props.traces,
      isDragging,
      selectCourse,
      selectDay,
      onTraceClick: props.onTraceClick,
    }),
    [
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

  return (
    <>
      <div
        ref={root}
        className={cn("flex min-h-0 flex-1 flex-col", props.editing && "select-none")}
        data-schedule-editing={props.editing || undefined}
        inert={props.editing && !props.enabled}
      >
        {props.editing && (
          <div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("scheduleEditor.previousWeek")}
                disabled={!props.enabled || props.selectedWeek <= 1}
                onClick={() => props.onShiftWeek(-1)}
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm font-medium" aria-live="polite">
                {t("scheduleEditor.viewedWeek", { week: props.selectedWeek })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("scheduleEditor.nextWeek")}
                disabled={!props.enabled || props.selectedWeek >= props.totalWeeks}
                onClick={() => props.onShiftWeek(1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t("scheduleEditor.dragHint")}
            </p>
          </div>
        )}
        {props.children(editor)}
      </div>

      {active && (
        <>
          <div
            ref={preview}
            className="pointer-events-none fixed z-50 rounded border-2 border-dashed"
          />
          <div
            ref={overlay}
            className="pointer-events-none fixed top-0 left-0 z-50 flex w-44 flex-col gap-1 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
          >
            <span className="font-medium">
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
      )}
    </>
  )
}
