import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

export const BACK_PRIORITY = {
  page: 10,
  gesture: 20,
  overlay: 100,
  foreground: 200,
} as const

export type RegisterBackLayer = (onBack: () => void, priority: number) => () => void

const BackRegistrarContext = createContext<RegisterBackLayer | null>(null)
const BackDepthContext = createContext(0)

export function BackLayerProvider({
  registerBackHandler,
  children,
}: {
  registerBackHandler: RegisterBackLayer
  children: ReactNode
}) {
  return (
    <BackRegistrarContext.Provider value={registerBackHandler}>
      {children}
    </BackRegistrarContext.Provider>
  )
}

export function useBackHandler(
  onBack: () => void,
  enabled = true,
  priority: number = BACK_PRIORITY.page
) {
  const register = useContext(BackRegistrarContext)
  const latest = useRef(onBack)
  useLayoutEffect(() => {
    latest.current = onBack
  }, [onBack])
  useLayoutEffect(() => {
    if (!enabled || !register) return
    return register(() => latest.current(), priority)
  }, [enabled, priority, register])
}

/** Modal descendants outrank their containing layer even when mounted in the same commit. */
export function useBackLayer(onBack: () => void, enabled = true) {
  const depth = useContext(BackDepthContext)
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
  const depth = useContext(BackDepthContext)
  useBackLayer(onBack, enabled)
  return <BackDepthContext.Provider value={depth + 1}>{children}</BackDepthContext.Provider>
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
