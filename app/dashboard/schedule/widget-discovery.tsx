"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { createPortal } from "react-dom"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import { toast } from "sonner"
import buroImage from "@/public/widgets/buro.png"
import { useIsMobile } from "@/hooks/use-mobile"
import { isCapacitor } from "@/lib/native/platform"
import { requestWidgetPin } from "@/lib/native/widget-bridge"
import { useSettingsStore, type WidgetAssistantPosition } from "@/lib/stores/settings"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"

const WIDGET_SETTINGS_HREF = "/dashboard/me/settings/widgets"
const DRAG_THRESHOLD = 8
const LONG_PRESS_MS = 600

type MessageKey =
  | "discover"
  | "playful1"
  | "playful2"
  | "tease"
  | "ten"
  | "twenty"
  | "fifty"
  | "seventyFive"
  | "farewell"

function messageKeyForCount(count: number): MessageKey {
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

interface GestureState {
  pointerId: number | null
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  dragging: boolean
}

interface BubbleLayout {
  left: number
  top?: number
  bottom?: number
  width: number
  tailX: number
  placement: "top" | "bottom"
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function WidgetDiscovery({ suspended = false }: { suspended?: boolean }) {
  const router = useRouter()
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const hidden = useSettingsStore((s) => s.widgetAssistantHidden)
  const setHidden = useSettingsStore((s) => s.setWidgetAssistantHidden)
  const position = useSettingsStore((s) => s.widgetAssistantPosition)
  const setPosition = useSettingsStore((s) => s.setWidgetAssistantPosition)
  const [native, setNative] = useState(false)
  const [mobileNavHeight, setMobileNavHeight] = useState<number | null>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [draftPosition, setDraftPosition] = useState<WidgetAssistantPosition | null>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [interactionCount, setInteractionCount] = useState(0)
  const [messageKey, setMessageKey] = useState<MessageKey>("discover")
  const [departing, setDeparting] = useState(false)
  const [bubbleLayout, setBubbleLayout] = useState<BubbleLayout | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const departureTimer = useRef<NodeJS.Timeout | undefined>(undefined)
  const longPressTimer = useRef<NodeJS.Timeout | null>(null)
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
    if (!isCapacitor()) return
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"]')
    const height = nav?.getBoundingClientRect().height ?? 0
    // Set the initial offset in the same commit as native visibility, before motion starts.
    setMobileNavHeight(height > 0 ? height : null)
    setNative(true)
  }, [])

  useEffect(() => {
    const updateViewport = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    updateViewport()
    window.addEventListener("resize", updateViewport)
    return () => window.removeEventListener("resize", updateViewport)
  }, [])

  useEffect(() => {
    if (!native || !isMobile || suspended) return
    const nav = document.querySelector<HTMLElement>('nav[aria-label="Primary"]')
    if (!nav) {
      setMobileNavHeight(null)
      return
    }

    const updateHeight = () => {
      const height = nav.getBoundingClientRect().height
      setMobileNavHeight(height > 0 ? height : null)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [native, isMobile, suspended])

  useEffect(() => {
    if (suspended) setOpen(false)
  }, [suspended])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const clearLongPressTimer = useCallback(() => {
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

  const hideAssistant = useCallback(() => {
    setHidden(true)
    setOpen(false)
    toast.success(t("desktopWidgets.assistantHidden"))
  }, [setHidden, t])

  function positionFromPointer(clientX: number, clientY: number): WidgetAssistantPosition {
    const width = viewport.width || window.innerWidth
    const height = viewport.height || window.innerHeight
    const bottomReserved = isMobile ? (mobileNavHeight ?? 0) + 16 : 16
    const { offsetX, offsetY } = gestureRef.current
    const centerX = clamp(clientX + offsetX, 16 + iconSize / 2, width - 16 - iconSize / 2)
    const centerY = clamp(
      clientY + offsetY,
      16 + iconSize / 2,
      height - bottomReserved - iconSize / 2
    )
    return { x: centerX / width, y: centerY / height }
  }

  function calculateBubbleLayout(height: number): BubbleLayout {
    const width = Math.min(320, window.innerWidth - 32)
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return { left: 16, bottom: 16, width, tailX: 24, placement: "top" }

    const centerX = rect.left + rect.width / 2
    const left = clamp(centerX - width / 2, 16, window.innerWidth - width - 16)
    const placement = bubbleLayout?.placement ?? (rect.top >= height + 28 ? "top" : "bottom")
    const top = placement === "bottom" ? rect.bottom + 12 : undefined
    const bottom = placement === "top" ? window.innerHeight - rect.top + 12 : undefined
    const tailX = clamp(centerX - left - 6, 12, width - 24)
    return { left, top, bottom, width, tailX, placement }
  }

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const height = bubbleRef.current?.offsetHeight
      if (height) setBubbleLayout(calculateBubbleLayout(height))
    })
    return () => cancelAnimationFrame(frame)
  }, [open, viewport, displayedPosition])

  function openBubble() {
    const count = interactionCount + 1
    setInteractionCount(count)
    setMessageKey(messageKeyForCount(count))
    setBubbleLayout(calculateBubbleLayout(180))
    setOpen(true)

    if (count === 100) {
      clearLongPressTimer()
      setDeparting(true)
      departureTimer.current = setTimeout(() => setHidden(true), 1400)
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || gestureRef.current.pointerId !== null) return
    const rect = event.currentTarget.getBoundingClientRect()
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
    event.currentTarget.setPointerCapture(event.pointerId)
    clearLongPressTimer()
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      hideAssistant()
    }, LONG_PRESS_MS)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
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

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = gestureRef.current
    if (gesture.pointerId !== event.pointerId) return
    clearLongPressTimer()
    if (gesture.dragging) setPosition(positionFromPointer(event.clientX, event.clientY))
    setDraftPosition(null)
    gesture.pointerId = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (gestureRef.current.pointerId !== event.pointerId) return
    clearLongPressTimer()
    gestureRef.current.pointerId = null
    setDraftPosition(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function onClick() {
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

  async function addScheduleWidget() {
    if (adding) return
    setAdding(true)
    const added = await requestWidgetPin("schedule")
    setAdding(false)
    setOpen(false)

    if (added) {
      toast.success(t("desktopWidgets.added"))
      return
    }
    router.push(`${WIDGET_SETTINGS_HREF}#widget-manual-guide`)
    toast.info(t("desktopWidgets.unsupported"))
  }

  if (
    !native ||
    hidden ||
    suspended ||
    (isMobile && !displayedPosition && mobileNavHeight === null) ||
    (displayedPosition && viewport.width === 0)
  ) {
    return null
  }

  const rootStyle: CSSProperties = {}
  if (displayedPosition) {
    rootStyle.left = displayedPosition.x * viewport.width - iconSize / 2
    rootStyle.top = displayedPosition.y * viewport.height - iconSize / 2
    rootStyle.right = "auto"
    rootStyle.bottom = "auto"
    rootStyle.width = iconSize
    rootStyle.height = iconSize
  } else if (isMobile && mobileNavHeight !== null) {
    rootStyle.bottom = `${mobileNavHeight + 16}px`
  }
  const placement = bubbleLayout?.placement ?? "top"

  return createPortal(
    <div
      ref={rootRef}
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
              bottom: bubbleLayout?.bottom ?? (placement === "top" ? 16 : undefined),
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
                  {t(`desktopWidgets.assistantMessages.${messageKey}`, {
                    count: interactionCount,
                  })}
                </motion.span>
              </AnimatePresence>
              {messageKey === "discover" && (
                <>
                  <button
                    type="button"
                    disabled={adding}
                    onClick={addScheduleWidget}
                    className="mx-1 inline-flex rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
                  >
                    {adding ? t("desktopWidgets.adding") : t("desktopWidgets.assistantAdd")}
                  </button>
                  {t("desktopWidgets.assistantMoreBefore")}
                  <Link
                    href={WIDGET_SETTINGS_HREF}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    {t("desktopWidgets.assistantMoreLink")}
                  </Link>
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
        <Image
          src={buroImage}
          alt=""
          draggable={false}
          priority
          className="pointer-events-none size-full object-contain drop-shadow-md"
        />
      </motion.button>
    </div>,
    document.body
  )
}
