import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { schedulePatchDependents, type SchedulePatch } from "@/lib/academic/schedule-patches"
import { STORAGE_KEYS } from "@/lib/storage/keys"
import { secureStorage } from "@/lib/storage/secure"

interface SchedulePatchesState {
  byScope: Record<string, SchedulePatch[]>
  hasHydrated: boolean
  add: (scope: string, patch: SchedulePatch) => void
  remove: (scope: string, id: string) => void
  setEnabled: (scope: string, id: string, enabled: boolean) => void
}

// Serialize asynchronous native writes so a slow earlier save cannot undo a later edit.
let writes: Promise<void> = Promise.resolve()
const patchStorage = {
  getItem: secureStorage.getItem,
  removeItem: secureStorage.removeItem,
  setItem: (name: string, value: string) => {
    writes = writes.then(() => secureStorage.setItem(name, value))
    return writes
  },
}

export const useSchedulePatchesStore = create<SchedulePatchesState>()(
  persist(
    (set, get) => ({
      byScope: {},
      hasHydrated: false,
      add: (scope, patch) => {
        if (!get().hasHydrated || !scope) throw new Error("scheduleEditor.notReady")
        set((state) => ({
          byScope: { ...state.byScope, [scope]: [...(state.byScope[scope] ?? []), patch] },
        }))
      },
      remove: (scope, id) => {
        if (!get().hasHydrated || !scope) return
        set((state) => {
          const patches = state.byScope[scope] ?? []
          const removed = new Set([id, ...schedulePatchDependents(patches, id)])
          return {
            byScope: {
              ...state.byScope,
              [scope]: patches.filter((patch) => !removed.has(patch.id)),
            },
          }
        })
      },
      setEnabled: (scope, id, enabled) => {
        if (!get().hasHydrated || !scope) return
        set((state) => {
          const patches = state.byScope[scope] ?? []
          const target = patches.find((patch) => patch.id === id)
          if (!target) return state
          if (
            enabled &&
            target.dependsOn.some(
              (dependency) => !patches.some((patch) => patch.id === dependency && patch.enabled)
            )
          ) {
            throw new Error("scheduleEditor.issue_missingDependency")
          }
          const affected = new Set(enabled ? [id] : [id, ...schedulePatchDependents(patches, id)])
          return {
            byScope: {
              ...state.byScope,
              [scope]: patches.map((patch) =>
                affected.has(patch.id) ? { ...patch, enabled } : patch
              ),
            },
          }
        })
      },
    }),
    {
      name: STORAGE_KEYS.schedulePatches,
      storage: createJSONStorage(() => patchStorage),
      partialize: (state) => ({ byScope: state.byScope }),
      skipHydration: true,
      // Hydration must not itself save an empty default over the durable user data.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Pick<SchedulePatchesState, "byScope"> | undefined),
        hasHydrated: true,
      }),
    }
  )
)

let hydration: Promise<void> | undefined
export function hydrateSchedulePatches(): Promise<void> {
  hydration ??= Promise.resolve(useSchedulePatchesStore.persist.rehydrate())
  return hydration
}
