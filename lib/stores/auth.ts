import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { secureStorage } from "../storage/secure"
import { STORAGE_KEYS } from "../storage/keys"

interface StoredCredential {
  credential: string
  username: string | null
}

interface AuthState {
  credential: string | null
  credentialsBySchool: Record<string, StoredCredential>
  activeSchoolId: string
  jwxtSession: string | null
  mobileSession: string | null
  username: string | null
  isAuthenticated: boolean
  sessionExpired: boolean
  hasHydrated: boolean
  setCredential: (credential: string, username?: string, schoolId?: string) => void
  activateSchool: (schoolId: string) => void
  setJWXTSession: (session: string) => void
  setMobileSession: (session: string) => void
  setSessionExpired: (expired: boolean) => void
  clearCredential: (schoolId?: string) => void
  setHasHydrated: (v: boolean) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      credential: null,
      credentialsBySchool: {},
      activeSchoolId: "ysu",
      jwxtSession: null,
      mobileSession: null,
      username: null,
      isAuthenticated: false,
      sessionExpired: false,
      hasHydrated: false,
      setCredential: (credential, username, schoolId = "ysu") =>
        set((state) => ({
          credential,
          activeSchoolId: schoolId,
          credentialsBySchool: {
            ...state.credentialsBySchool,
            [schoolId]: { credential, username: username ?? null },
          },
          username,
          isAuthenticated: true,
          sessionExpired: false,
          jwxtSession: null,
          mobileSession: null,
        })),
      activateSchool: (schoolId) =>
        set((state) => {
          const stored = state.credentialsBySchool[schoolId]
          return {
            activeSchoolId: schoolId,
            credential: stored?.credential ?? null,
            username: stored?.username ?? null,
            isAuthenticated: !!stored,
            sessionExpired: false,
            jwxtSession: null,
            mobileSession: null,
          }
        }),
      setJWXTSession: (jwxtSession) => set({ jwxtSession }),
      setMobileSession: (mobileSession) => set({ mobileSession }),
      setSessionExpired: (sessionExpired) => set({ sessionExpired }),
      clearCredential: (schoolId = "ysu") =>
        set((state) => {
          const credentialsBySchool = { ...state.credentialsBySchool }
          delete credentialsBySchool[schoolId]
          return {
            credentialsBySchool,
            ...(state.activeSchoolId === schoolId
              ? {
                  credential: null,
                  jwxtSession: null,
                  mobileSession: null,
                  username: null,
                  isAuthenticated: false,
                  sessionExpired: false,
                }
              : {}),
          }
        }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEYS.auth,
      storage: createJSONStorage(() => secureStorage),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) return current
        const merged = Object.assign({}, current, persisted)
        const credentialsBySchool = {
          ...current.credentialsBySchool,
          ...merged.credentialsBySchool,
        }
        if (merged.credential && !credentialsBySchool.ysu) {
          credentialsBySchool.ysu = {
            credential: merged.credential,
            username: merged.username,
          }
        }
        return { ...merged, credentialsBySchool }
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
