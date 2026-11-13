import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { secureStorage } from "@orahako/plugin-sdk/host"
import { PerlicaClient, type PerlicaConfig } from "./client"
import type { PerlicaCoords } from "./types"

const DEFAULT_CENTER: PerlicaCoords = { lat: 39.93450164794922, lng: 119.61062622070312 }

/** Package-owned persistence namespace; external plugins cannot share host storage keys. */
export const PERLICA_STORAGE_KEY = "community.perlica-toybox.credentials"

export interface PerlicaState {
  token: string
  accountId: string
  adAccountId: string
  center: PerlicaCoords
  locationConfirmed: boolean
  radius: number
  hasHydrated: boolean
  login: (config: PerlicaConfig) => void
  logout: () => void
  setCenter: (center: PerlicaCoords) => void
  setRadius: (radius: number) => void
  setHasHydrated: (value: boolean) => void
}

export const usePerlicaStore = create<PerlicaState>()(
  persist(
    (set) => ({
      token: "",
      accountId: "",
      adAccountId: "11423",
      center: DEFAULT_CENTER,
      locationConfirmed: false,
      radius: 3000,
      hasHydrated: false,
      login: ({ token, accountId, adAccountId }) =>
        set({
          token: token.trim(),
          accountId: accountId.trim(),
          adAccountId: adAccountId?.trim() || "11423",
          locationConfirmed: false,
        }),
      logout: () =>
        set({ token: "", accountId: "", adAccountId: "11423", locationConfirmed: false }),
      setCenter: (center) => set({ center, locationConfirmed: true }),
      setRadius: (radius) => set({ radius: Math.min(20000, Math.max(200, Math.round(radius))) }),
      setHasHydrated: (value) => set({ hasHydrated: value, locationConfirmed: false }),
    }),
    {
      name: PERLICA_STORAGE_KEY,
      storage: createJSONStorage(() => secureStorage),
      partialize: (state) => ({
        token: state.token,
        accountId: state.accountId,
        adAccountId: state.adAccountId,
        center: state.center,
        radius: state.radius,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

/** Construct a client only after both required credential fields are configured. */
export function getPerlicaClient(): PerlicaClient | null {
  const { token, accountId, adAccountId } = usePerlicaStore.getState()
  if (!token || !accountId) return null
  return new PerlicaClient({ token, accountId, adAccountId })
}
