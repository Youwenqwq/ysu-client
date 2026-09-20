"use client"

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { BACK_PRIORITY, registerBackHandler } from "@/lib/navigation/back"

const BackDepth = createContext(0)

export function useBackHandler(
  onBack: () => void,
  enabled = true,
  priority: number = BACK_PRIORITY.page
) {
  const latest = useRef(onBack)
  useLayoutEffect(() => {
    latest.current = onBack
  }, [onBack])
  useLayoutEffect(() => {
    if (!enabled) return
    return registerBackHandler(() => latest.current(), priority)
  }, [enabled, priority])
}

/** Modal descendants outrank their containing layer even when mounted in the same commit. */
export function useBackLayer(onBack: () => void, enabled = true) {
  const depth = useContext(BackDepth)
  useBackHandler(onBack, enabled, BACK_PRIORITY.overlay + depth)
}

export function BackLayer({
  enabled,
  onBack,
  children,
}: {
  enabled: boolean
  onBack: () => void
  children: ReactNode
}) {
  const depth = useContext(BackDepth)
  useBackLayer(onBack, enabled)
  return <BackDepth.Provider value={depth + 1}>{children}</BackDepth.Provider>
}

/** Preserve controlled close vetoes while also supporting uncontrolled primitive roots. */
export function useBackOpenState({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const changeOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [open, onOpenChange]
  )
  return { open: open ?? internalOpen, onOpenChange: changeOpen }
}
