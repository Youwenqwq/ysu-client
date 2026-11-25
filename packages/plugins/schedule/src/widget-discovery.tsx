import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import type { Translator } from "@orahako/sdk"
import { cn, useIsMobile } from "@orahako/ui-primitives"
import type { ScheduleDictionary } from "./dictionary"
import type { WidgetAssistantPosition } from "./stores"

const DRAG_THRESHOLD = 8
const LONG_PRESS_MS = 600

type AssistantMessageKey =
  | "discover"
  | "playful1"
  | "playful2"
  | "tease"
  | "ten"
  | "twenty"
  | "fifty"
  | "seventyFive"
  | "farewell"

function messageKeyForCount(count: number): AssistantMessageKey {
  if (count >= 100) return "farewell"
  if (count === 1) return "discover"
  if (count === 2) return "playful1"
  if (count === 3) return "playful2"
  if (count < 10) return "tease"
  if (count < 20) return "ten"
  if (count < 50) return "twenty"
  if (count < 75) return "fifty"
  return "seventyFive"
}

function translateAssistantMessage(
  t: Translator<ScheduleDictionary>,
  key: AssistantMessageKey,
  count: number
): string {
  switch (key) {
    case "discover":
      return t("desktopWidgets.assistantMessages.discover")
    case "playful1":
      return t("desktopWidgets.assistantMessages.playful1")
    case "playful2":
      return t("desktopWidgets.assistantMessages.playful2")
    case "tease":
      return t("desktopWidgets.assistantMessages.tease")
    case "ten":
      return t("desktopWidgets.assistantMessages.ten", { count })
    case "twenty":
      return t("desktopWidgets.assistantMessages.twenty", { count })
    case "fifty":
      return t("desktopWidgets.assistantMessages.fifty", { count })
    case "seventyFive":
      return t("desktopWidgets.assistantMessages.seventyFive", { count })
    case "farewell":
      return t("desktopWidgets.assistantMessages.farewell")
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

interface GestureState {
  pointerId: number | null
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  dragging: boolean
}

interface BubbleLayout {
  readonly left: number
  readonly top?: number
  readonly bottom?: number
  readonly width: number
  readonly tailX: number
  readonly placement: "top" | "bottom"
}

export function WidgetAssistantAvatar({
  src,
  className,
}: {
  readonly src: string
  readonly className?: string
}): ReactNode {
  return (
    // Package assets may be Blob URLs and packages must not import next/image.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      draggable={false}
      data-widget-assistant-avatar=""
      className={cn("pointer-events-none object-contain", className)}
    />
  )
}

export interface WidgetDiscoveryProps {
  readonly isNative: boolean
  readonly hidden: boolean
  readonly position: WidgetAssistantPosition | null
  readonly suspended?: boolean
  readonly assistantSrc: string
  readonly widgetsSettingsHref: string
  readonly t: Translator<ScheduleDictionary>
  readonly onSetHidden: (hidden: boolean) => void
  readonly onSetPosition: (position: WidgetAssistantPosition | null) => void
  readonly onRequestPinSchedule: () => Promise<boolean>
  readonly onOpenWidgetsSettings: () => void
}

export function WidgetDiscovery({
  isNative,
  hidden,
  position,
  suspended = false,
  assistantSrc,
  widgetsSettingsHref,
  t,
  onSetHidden,
  onSetPosition,
  onRequestPinSchedule,
  onOpenWidgetsSettings,
}: WidgetDiscoveryProps): ReactNode {
  const isMobile = useIsMobile()
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth || 390 : 390,
    height: typeof window !== "undefined" ? window.innerHeight || 844 : 844,
  }))
  const [mobileNavHeight, setMobileNavHeight] = useState<number>(64)
  const [draftPosition, setDraftPosition] = useState<WidgetAssistantPosition | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [interactionCount, setInteractionCount] = useState(0)
  const [messageKey, setMessageKey] = useState<AssistantMessageKey>("discover")
  const [departing, setDeparting] = useState(false)
  const [bubbleLayout, setBubbleLayout] = useState<BubbleLayout | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const departureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didDrag = useRef(false)
  const longPressTriggered = useRef(false)
  const gestureRef = useRef<GestureState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
  })

  const displayedPosition = draftPosition ?? position
  const iconSize = isMobile ? 56 : 64

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return
    const updateViewport = (): void => {
      setViewport({
        width: window.innerWidth || 390,
        height: window.innerHeight || 844,
      })
    }
    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [])

  useEffect(() => {
    if (!isNative || !isMobile || suspended) return
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return
    const nav = document.querySelector<HTMLElement>("[data-shell-bottom-nav]")
    if (!nav) return

    const updateHeight = (): void => {
      const height = nav.getBoundingClientRect?.().height ?? 0
      if (height > 0) setMobileNavHeight(height)
    }
    updateHeight()
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(updateHeight)
      observer.observe(nav)
      return () => observer.disconnect()
    }
    return undefined
  }, [isMobile, isNative, suspended])

  useEffect(() => {
    if (suspended) setOpen(false)
  }, [suspended])

  useEffect(() => {
    if (!open) return
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const clearLongPressTimer = useCallback((): void => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearLongPressTimer()
      clearTimeout(departureTimer.current)
    }
  }, [clearLongPressTimer])

  const hideAssistant = useCallback((): void => {
    onSetHidden(true)
    setOpen(false)
    toast.success(t("desktopWidgets.assistantHidden"))
  }, [onSetHidden, t])

  const positionFromPointer = (clientX: number, clientY: number): WidgetAssistantPosition => {
    const width = viewport.width || 390
    const height = viewport.height || 844
    const bottomReserved = isMobile ? mobileNavHeight + 16 : 16
    const { offsetX, offsetY } = gestureRef.current
    const centerX = clamp(clientX + offsetX, 16 + iconSize / 2, width - 16 - iconSize / 2)
    const centerY = clamp(
      clientY + offsetY,
      16 + iconSize / 2,
      Math.max(16 + iconSize / 2, height - bottomReserved - iconSize / 2)
    )
    return { x: centerX / width, y: centerY / height }
  }

  const calculateBubbleLayout = useCallback(
    (height: number): BubbleLayout => {
      const winWidth = typeof window !== "undefined" && window.innerWidth ? window.innerWidth : 390
      const winHeight =
        typeof window !== "undefined" && window.innerHeight ? window.innerHeight : 844
      const width = Math.min(320, Math.max(200, winWidth - 32))
      const rect = buttonRef.current?.getBoundingClientRect?.()
      if (!rect || rect.width === 0) {
        return { left: 16, bottom: 88, width, tailX: 24, placement: "top" }
      }

      const centerX = rect.left + rect.width / 2
      const left = clamp(centerX - width / 2, 16, Math.max(16, winWidth - width - 16))
      const placement = bubbleLayout?.placement ?? (rect.top >= height + 28 ? "top" : "bottom")
      const top = placement === "bottom" ? rect.bottom + 12 : undefined
      const bottom = placement === "top" ? winHeight - rect.top + 12 : undefined
      const tailX = clamp(centerX - left - 6, 12, width - 24)
      return { left, top, bottom, width, tailX, placement }
    },
    [bubbleLayout?.placement]
  )

  useEffect(() => {
    if (!open || typeof requestAnimationFrame !== "function") return
    const frame = requestAnimationFrame(() => {
      const height = bubbleRef.current?.offsetHeight
      if (height) setBubbleLayout(calculateBubbleLayout(height))
    })
    return () => cancelAnimationFrame(frame)
  }, [calculateBubbleLayout, displayedPosition, open, viewport])

  const openBubble = (): void => {
    const count = interactionCount + 1
    setInteractionCount(count)
    setMessageKey(messageKeyForCount(count))
    setBubbleLayout(calculateBubbleLayout(180))
    setOpen(true)

    if (count === 100) {
      clearLongPressTimer()
      setDeparting(true)
      departureTimer.current = setTimeout(() => onSetHidden(true), 1400)
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0 || gestureRef.current.pointerId !== null) return
    const rect = event.currentTarget.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: iconSize,
      height: iconSize,
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: rect.left + rect.width / 2 - event.clientX,
      offsetY: rect.top + rect.height / 2 - event.clientY,
      dragging: false,
    }
    didDrag.current = false
    longPressTriggered.current = false
    setDraftPosition(displayedPosition)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    clearLongPressTimer()
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      hideAssistant()
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current
    if (gesture.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY)
    if (!gesture.dragging && distance >= DRAG_THRESHOLD) {
      gesture.dragging = true
      didDrag.current = true
      clearLongPressTimer()
      setOpen(false)
    }
    if (!gesture.dragging) return
    event.preventDefault()
    setDraftPosition(positionFromPointer(event.clientX, event.clientY))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const gesture = gestureRef.current
    if (gesture.pointerId !== event.pointerId) return
    clearLongPressTimer()
    if (gesture.dragging) {
      onSetPosition(positionFromPointer(event.clientX, event.clientY))
    }
    setDraftPosition(null)
    gesture.pointerId = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }

  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (gestureRef.current.pointerId !== event.pointerId) return
    clearLongPressTimer()
    gestureRef.current.pointerId = null
    setDraftPosition(null)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }

  const onClick = (): void => {
    if (didDrag.current) {
      didDrag.current = false
      return
    }
    if (longPressTriggered.current) {
      longPressTriggered.current = false
      return
    }
    openBubble()
  }

  const addScheduleWidget = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    const added = await onRequestPinSchedule()
    setAdding(false)
    setOpen(false)

    if (added) {
      toast.success(t("desktopWidgets.added"))
      return
    }
    onOpenWidgetsSettings()
    toast.info(t("desktopWidgets.unsupported"))
  }

  const handleSettingsLinkClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    setOpen(false)
    onOpenWidgetsSettings()
  }

  if (!isNative || hidden || suspended) {
    return null
  }

  const rootStyle: CSSProperties = {}
  if (displayedPosition && viewport.width > 0 && viewport.height > 0) {
    rootStyle.left = displayedPosition.x * viewport.width - iconSize / 2
    rootStyle.top = displayedPosition.y * viewport.height - iconSize / 2
    rootStyle.right = "auto"
    rootStyle.bottom = "auto"
    rootStyle.width = iconSize
    rootStyle.height = iconSize
  } else if (isMobile) {
    rootStyle.bottom = `${mobileNavHeight + 16}px`
  }

  const placement = bubbleLayout?.placement ?? "top"

  const assistant = (
    <div
      ref={rootRef}
      data-widget-discovery=""
      style={rootStyle}
      className="fixed right-4 bottom-4 z-40 md:right-6 md:bottom-6"
    >
      <AnimatePresence>
        {open && (
          <motion.div
            ref={bubbleRef}
            id="widget-discovery-bubble"
            role="dialog"
            aria-label={t("desktopWidgets.title")}
            initial={{ opacity: 0, scale: 0.72, y: placement === "top" ? 14 : -14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.82, y: placement === "top" ? 8 : -8 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
            style={{
              left: bubbleLayout?.left ?? 16,
              top: bubbleLayout?.top ?? (placement === "bottom" ? 16 : undefined),
              bottom: bubbleLayout?.bottom ?? (placement === "top" ? 88 : undefined),
              width: bubbleLayout?.width ?? 320,
              transformOrigin: `${(bubbleLayout?.tailX ?? 24) + 6}px ${placement === "top" ? "100%" : "0%"}`,
            }}
            className="fixed max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <p className="text-sm leading-6">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={`${messageKey}-${interactionCount}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                  className="inline"
                >
                  {translateAssistantMessage(t, messageKey, interactionCount)}
                </motion.span>
              </AnimatePresence>
              {messageKey === "discover" && (
                <>
                  <button
                    type="button"
                    data-widget-discovery-add=""
                    disabled={adding}
                    onClick={() => void addScheduleWidget()}
                    className="mx-1 inline-flex rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
                  >
                    {adding ? t("desktopWidgets.adding") : t("desktopWidgets.assistantAdd")}
                  </button>
                  {t("desktopWidgets.assistantMoreBefore")}
                  <a
                    href={widgetsSettingsHref}
                    onClick={handleSettingsLinkClick}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {t("desktopWidgets.assistantMoreLink")}
                  </a>
                  {t("desktopWidgets.assistantMoreAfter")}
                </>
              )}
            </p>
            {messageKey !== "farewell" && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t("desktopWidgets.assistantHideHint")}
              </p>
            )}
            <span
              style={{
                left: bubbleLayout?.tailX ?? 24,
                ...(placement === "top" ? { bottom: -6 } : { top: -6 }),
              }}
              className={cn(
                "absolute size-3 rotate-45 border-border bg-popover",
                placement === "top" ? "border-r border-b" : "border-t border-l"
              )}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        ref={buttonRef}
        type="button"
        data-widget-discovery-trigger=""
        disabled={departing}
        aria-label={t("desktopWidgets.assistantLabel")}
        aria-expanded={open}
        aria-controls="widget-discovery-bubble"
        title={t("desktopWidgets.assistantHideHint")}
        initial={{ opacity: 0, scale: 0, rotate: -14 }}
        animate={
          departing
            ? {
                opacity: [1, 1, 1, 0.85, 0],
                scale: [1, 1.22, 0.92, 0.62, 0],
                rotate: [0, -16, 18, -28, -48],
                x: [0, -12, 12, 36, 96],
                y: [0, 2, -10, 10, 52],
              }
            : { opacity: 1, scale: 1, rotate: 0 }
        }
        whileHover={departing ? undefined : { scale: 1.08, rotate: -4 }}
        whileTap={departing ? undefined : { scale: 0.82 }}
        transition={
          departing
            ? { duration: 1.05, ease: "easeInOut" }
            : { type: "spring", stiffness: 360, damping: 16 }
        }
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
        className="block size-14 cursor-grab touch-none rounded-full select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:cursor-grabbing md:size-16"
      >
        <WidgetAssistantAvatar src={assistantSrc} className="size-full drop-shadow-md" />
      </motion.button>
    </div>
  )

  return typeof document === "undefined" ? null : createPortal(assistant, document.body)
}
