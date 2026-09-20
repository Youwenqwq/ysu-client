"use client"

import type { ReactNode } from "react"
import { useEffect } from "react"
import { create } from "zustand"

interface MobileHeaderState {
  rightSlot: ReactNode
  setRightSlot: (node: ReactNode) => void
  titleOverride: string | null
  titleHint: string | null
  fullscreen: boolean
  setLayout: (titleOverride: string | null, fullscreen: boolean, titleHint: string | null) => void
}

export const useMobileHeaderStore = create<MobileHeaderState>((set) => ({
  rightSlot: null,
  setRightSlot: (node) => set({ rightSlot: node }),
  titleOverride: null,
  titleHint: null,
  fullscreen: false,
  setLayout: (titleOverride, fullscreen, titleHint) =>
    set({ titleOverride, fullscreen, titleHint }),
}))

export function useMobileHeaderRight(node: ReactNode, deps: unknown[] = []) {
  const setRightSlot = useMobileHeaderStore((s) => s.setRightSlot)
  useEffect(() => {
    setRightSlot(node)
    return () => setRightSlot(null)
    // The `deps` array is intentionally forwarded from the caller — exhaustive-deps
    // cannot reason about its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/** Page-owned mobile shell overrides, always released on navigation. */
export function useMobileHeaderLayout(
  title: string | null,
  fullscreen: boolean,
  titleHint: string | null = null
) {
  const setLayout = useMobileHeaderStore((s) => s.setLayout)
  useEffect(() => {
    setLayout(title, fullscreen, titleHint)
    return () => setLayout(null, false, null)
  }, [title, fullscreen, titleHint, setLayout])
}
