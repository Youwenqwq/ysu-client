import { create } from "zustand"

export const PERLICA_TABS = ["map", "ride", "history", "account"] as const

export type PerlicaTab = (typeof PERLICA_TABS)[number]

export function isPerlicaTab(value: string | null | undefined): value is PerlicaTab {
  return (
    value !== null && value !== undefined && (PERLICA_TABS as readonly string[]).includes(value)
  )
}

interface PerlicaAppNavState {
  tab: PerlicaTab
  setTab: (tab: PerlicaTab) => void
}

/**
 * Section state shared by the main page and Settings. It is intentionally not
 * persisted: it only bridges the two plugin pages while the host keeps them
 * mounted, and always starts on the map for a fresh session.
 */
export const usePerlicaAppNav = create<PerlicaAppNavState>((set) => ({
  tab: "map",
  setTab: (tab) => set({ tab }),
}))
