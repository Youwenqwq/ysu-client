import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { secureStorage } from "./storage/secure"
import { STORAGE_KEYS } from "./storage/keys"

export interface StoredCredential {
  credential: string
  username: string | null
}

/** Opaque per-school session artifacts, named by whoever produced them. */
export type StoredArtifacts = Record<string, string>

export interface AuthState {
  credential: string | null
  credentialsBySchool: Record<string, StoredCredential>
  /** Null until a caller activates a school explicitly; there is no default. */
  activeSchoolId: string | null
  artifactsBySchool: Record<string, StoredArtifacts>
  artifacts: StoredArtifacts
  username: string | null
  isAuthenticated: boolean
  sessionExpired: boolean
  hasHydrated: boolean
  setCredential: (credential: string, username?: string | null, schoolId?: string) => void
  activateSchool: (schoolId: string) => void
  setArtifact: (key: string, value: string | null, schoolId?: string) => void
  getArtifact: (key: string, schoolId?: string) => string | null
  setSessionExpired: (expired: boolean) => void
  clearCredential: (schoolId?: string) => void
  setHasHydrated: (v: boolean) => void
}

function requireSchoolId(
  schoolId: string | null | undefined,
  operation: string
): string {
  if (!schoolId) {
    throw new Error(
      `Cannot ${operation}: no school is active. Activate a school first or pass an explicit schoolId.`
    )
  }
  return schoolId
}

/**
 * Secure persistence for the default Session service. Artifact operations
 * require an explicit or active school and never fall back to a default.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      credential: null,
      credentialsBySchool: {},
      activeSchoolId: null,
      artifactsBySchool: {},
      artifacts: {},
      username: null,
      isAuthenticated: false,
      sessionExpired: false,
      hasHydrated: false,
      setCredential: (credential, username = null, schoolId) =>
        set((state) => {
          const school = requireSchoolId(
            schoolId ?? state.activeSchoolId,
            "store a credential"
          )
          return {
            credential,
            activeSchoolId: school,
            credentialsBySchool: {
              ...state.credentialsBySchool,
              [school]: { credential, username: username ?? null },
            },
            username: username ?? null,
            isAuthenticated: true,
            sessionExpired: false,
            // A fresh credential invalidates artifacts derived from the old one.
            artifactsBySchool: { ...state.artifactsBySchool, [school]: {} },
            artifacts: {},
          }
        }),
      activateSchool: (schoolId) =>
        set((state) => {
          const school = requireSchoolId(schoolId, "activate a school")
          const stored = state.credentialsBySchool[school]
          const artifacts = state.artifactsBySchool[school] ?? {}
          return {
            activeSchoolId: school,
            credential: stored?.credential ?? null,
            username: stored?.username ?? null,
            isAuthenticated: Boolean(stored),
            // Expiry describes the previous session, not the restored credential.
            sessionExpired: false,
            artifacts,
          }
        }),
      setArtifact: (key, value, schoolId) =>
        set((state) => {
          if (!key) {
            throw new Error("Cannot store a session artifact without a key.")
          }
          const school = requireSchoolId(
            schoolId ?? state.activeSchoolId,
            `store session artifact "${key}"`
          )
          const next = { ...(state.artifactsBySchool[school] ?? {}) }
          if (value === null) delete next[key]
          else next[key] = value
          const artifactsBySchool = { ...state.artifactsBySchool, [school]: next }
          if (state.activeSchoolId !== school) return { artifactsBySchool }
          return {
            artifactsBySchool,
            artifacts: next,
          }
        }),
      getArtifact: (key, schoolId) => {
        const state = get()
        const school = requireSchoolId(
          schoolId ?? state.activeSchoolId,
          `read session artifact "${key}"`
        )
        return state.artifactsBySchool[school]?.[key] ?? null
      },
      setSessionExpired: (sessionExpired) => set({ sessionExpired }),
      clearCredential: (schoolId) =>
        set((state) => {
          const school = requireSchoolId(
            schoolId ?? state.activeSchoolId,
            "clear a credential"
          )
          const credentialsBySchool = { ...state.credentialsBySchool }
          delete credentialsBySchool[school]
          const artifactsBySchool = { ...state.artifactsBySchool }
          delete artifactsBySchool[school]
          if (state.activeSchoolId !== school) {
            return { credentialsBySchool, artifactsBySchool }
          }
          return {
            credentialsBySchool,
            artifactsBySchool,
            credential: null,
            username: null,
            isAuthenticated: false,
            sessionExpired: false,
            artifacts: {},
          }
        }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEYS.auth,
      storage: createJSONStorage(() => secureStorage),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
          return current
        }
        const saved = persisted as Partial<AuthState>
        const credentialsBySchool = {
          ...current.credentialsBySchool,
          ...(saved.credentialsBySchool ?? {}),
        }
        const artifactsBySchool = {
          ...current.artifactsBySchool,
          ...(saved.artifactsBySchool ?? {}),
        }
        const persistedSchoolId =
          typeof saved.activeSchoolId === "string" && saved.activeSchoolId
            ? saved.activeSchoolId
            : null
        const activeSchoolId = persistedSchoolId ?? current.activeSchoolId
        const stored = activeSchoolId ? credentialsBySchool[activeSchoolId] : undefined
        const artifacts =
          (activeSchoolId ? artifactsBySchool[activeSchoolId] : undefined) ?? {}
        return {
          ...current,
          credentialsBySchool,
          artifactsBySchool,
          activeSchoolId,
          credential: stored?.credential ?? null,
          username: stored?.username ?? null,
          isAuthenticated: Boolean(stored),
          sessionExpired: Boolean(saved.sessionExpired),
          artifacts,
          hasHydrated: false,
        }
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
