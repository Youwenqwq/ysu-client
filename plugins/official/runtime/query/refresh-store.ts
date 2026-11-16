"use client"

import { create } from "zustand"

interface RefreshState {
  count: number
  stale: number
  start: () => void
  end: () => void
  markStale: () => void
  markFresh: () => void
}

export const useRefreshStore = create<RefreshState>((set) => ({
  count: 0,
  stale: 0,
  start: () => set((s) => ({ count: s.count + 1 })),
  end: () => set((s) => ({ count: Math.max(0, s.count - 1) })),
  markStale: () => set((s) => ({ stale: s.stale + 1 })),
  markFresh: () => set((s) => ({ stale: Math.max(0, s.stale - 1) })),
}))
