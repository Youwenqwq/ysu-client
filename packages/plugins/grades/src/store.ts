import type { Grade } from "@orahako/academic-sdk"
import { defineStore, type StoreInstance } from "@orahako/sdk"

export const ALL_TERM = "__all__"

type GradesSortMode = "default" | "asc" | "desc"

export interface GradesViewState {
  readonly term: string
  readonly sortMode: GradesSortMode
  readonly filterDrawerOpen: boolean
}

export const gradesViewStore = defineStore({
  init: (): GradesViewState => ({ term: ALL_TERM, sortMode: "default", filterDrawerOpen: false }),
  actions: {
    setTerm(ctx, term: string) {
      ctx.set((prev) => (prev.term === term ? prev : { ...prev, term }))
    },
    setDefaultTerm(ctx, term: string) {
      if (term !== ALL_TERM) {
        ctx.set((prev) => (prev.term === ALL_TERM ? { ...prev, term } : prev))
      }
    },
    setSortMode(ctx, sortMode: GradesSortMode) {
      ctx.set((prev) => (prev.sortMode === sortMode ? prev : { ...prev, sortMode }))
    },
    cycleSort(ctx) {
      ctx.set((prev) => ({
        ...prev,
        sortMode:
          prev.sortMode === "default" ? "desc" : prev.sortMode === "desc" ? "asc" : "default",
      }))
    },
    setFilterDrawerOpen(ctx, filterDrawerOpen: boolean) {
      ctx.set((prev) =>
        prev.filterDrawerOpen === filterDrawerOpen ? prev : { ...prev, filterDrawerOpen }
      )
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type GradesViewStoreInstance = StoreInstance<
  GradesViewState,
  typeof gradesViewStore.spec.actions
>

export const ANONYMOUS_GRADE_USER = "__anonymous__"

export function normalizeGradeUser(username: string | null | undefined): string {
  const trimmed = username?.trim()
  return trimmed ? trimmed : ANONYMOUS_GRADE_USER
}

export function gradeKey(grade: {
  readonly courseName: string
  readonly courseCode?: string
  readonly semester?: string
}): string {
  return `${grade.semester ?? ""}|${grade.courseCode ?? ""}|${grade.courseName}`
}

export function isGradeScored(grade: {
  readonly score?: string
  readonly gradeLevel?: string
}): boolean {
  return Boolean(grade.score?.trim() || grade.gradeLevel?.trim())
}

export interface PendingGrade {
  readonly key: string
  readonly courseName: string
  readonly semester?: string
  readonly score?: string
  readonly numericScore?: number
  readonly gradeLevel?: string
  readonly credit?: string
  readonly isPass: boolean
}

export function toPendingGrade(grade: Grade): PendingGrade {
  return {
    key: gradeKey(grade),
    courseName: grade.courseName,
    semester: grade.semester,
    score: grade.score,
    numericScore: grade.numericScore,
    gradeLevel: grade.gradeLevel,
    credit: grade.credit,
    isPass: grade.isPass,
  }
}

export interface GradesSettingsState {
  readonly gpaVisible: boolean
  readonly gradeGachaEnabled: boolean
}

export const gradesSettingsStore = defineStore({
  init: (): GradesSettingsState => ({
    gpaVisible: false,
    gradeGachaEnabled: true,
  }),
  persist: {
    key: "grades-settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setGpaVisible(ctx, gpaVisible: boolean) {
      ctx.set((prev) => (prev.gpaVisible === gpaVisible ? prev : { ...prev, gpaVisible }))
    },
    toggleGpaVisible(ctx) {
      ctx.set((prev) => ({ ...prev, gpaVisible: !prev.gpaVisible }))
    },
    setGradeGachaEnabled(ctx, gradeGachaEnabled: boolean) {
      ctx.set((prev) =>
        prev.gradeGachaEnabled === gradeGachaEnabled ? prev : { ...prev, gradeGachaEnabled }
      )
    },
  },
})

export type GradesSettingsStoreInstance = StoreInstance<
  GradesSettingsState,
  typeof gradesSettingsStore.spec.actions
>

export interface GradeGachaState {
  readonly revealedByUser: Readonly<Record<string, readonly string[]>>
  readonly pendingByUser: Readonly<Record<string, readonly PendingGrade[]>>
}

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values))
}

export const gradeGachaStore = defineStore({
  init: (): GradeGachaState => ({
    revealedByUser: {},
    pendingByUser: {},
  }),
  persist: {
    key: "grade-gacha",
    mode: "local",
    version: 1,
  },
  actions: {
    seedBaseline(ctx, username: string | null | undefined, grades: readonly Grade[]) {
      const user = normalizeGradeUser(username)
      const keys = uniqueStrings(grades.filter(isGradeScored).map(gradeKey))
      ctx.set((prev) => ({
        revealedByUser: {
          ...prev.revealedByUser,
          [user]: keys,
        },
        pendingByUser: {
          ...prev.pendingByUser,
          [user]: [],
        },
      }))
    },

    stageGrades(
      ctx,
      username: string | null | undefined,
      grades: readonly Grade[],
      gachaEnabled: boolean
    ) {
      const user = normalizeGradeUser(username)
      ctx.set((prev) => {
        const hasBaseline = Object.prototype.hasOwnProperty.call(prev.revealedByUser, user)
        const existingRevealed = prev.revealedByUser[user] ?? []
        const existingPending = prev.pendingByUser[user] ?? []
        const scored = grades.filter(isGradeScored)

        if (!gachaEnabled) {
          if (existingPending.length > 0) return prev
          const mergedKeys = uniqueStrings([...existingRevealed, ...scored.map(gradeKey)])
          if (
            hasBaseline &&
            mergedKeys.length === existingRevealed.length &&
            mergedKeys.every((k, idx) => k === existingRevealed[idx])
          ) {
            return prev
          }
          return {
            ...prev,
            revealedByUser: {
              ...prev.revealedByUser,
              [user]: mergedKeys,
            },
          }
        }

        if (!hasBaseline && existingPending.length === 0) {
          return {
            revealedByUser: {
              ...prev.revealedByUser,
              [user]: uniqueStrings(scored.map(gradeKey)),
            },
            pendingByUser: {
              ...prev.pendingByUser,
              [user]: [],
            },
          }
        }

        const revealedSet = new Set(existingRevealed)
        const stagedSet = new Set(existingPending.map((item) => item.key))
        const additions: PendingGrade[] = []

        for (const grade of scored) {
          const key = gradeKey(grade)
          if (revealedSet.has(key) || stagedSet.has(key)) continue
          additions.push(toPendingGrade(grade))
          stagedSet.add(key)
        }

        if (additions.length === 0) return prev
        return {
          ...prev,
          pendingByUser: {
            ...prev.pendingByUser,
            [user]: [...existingPending, ...additions],
          },
        }
      })
    },

    revealKeys(ctx, username: string | null | undefined, keys: readonly string[]) {
      if (keys.length === 0) return
      const user = normalizeGradeUser(username)
      const toReveal = new Set(keys)
      ctx.set((prev) => {
        const existingRevealed = prev.revealedByUser[user] ?? []
        const existingPending = prev.pendingByUser[user] ?? []
        const nextRevealed = uniqueStrings([...existingRevealed, ...keys])
        const nextPending = existingPending.filter((item) => !toReveal.has(item.key))
        return {
          revealedByUser: {
            ...prev.revealedByUser,
            [user]: nextRevealed,
          },
          pendingByUser: {
            ...prev.pendingByUser,
            [user]: nextPending,
          },
        }
      })
    },

    commitPending(ctx, username: string | null | undefined) {
      const user = normalizeGradeUser(username)
      ctx.set((prev) => {
        const existingPending = prev.pendingByUser[user] ?? []
        if (existingPending.length === 0) return prev
        const existingRevealed = prev.revealedByUser[user] ?? []
        const nextRevealed = uniqueStrings([
          ...existingRevealed,
          ...existingPending.map((item) => item.key),
        ])
        return {
          revealedByUser: {
            ...prev.revealedByUser,
            [user]: nextRevealed,
          },
          pendingByUser: {
            ...prev.pendingByUser,
            [user]: [],
          },
        }
      })
    },

    clearUser(ctx, username: string | null | undefined) {
      const user = normalizeGradeUser(username)
      ctx.set((prev) => {
        if (
          !Object.prototype.hasOwnProperty.call(prev.revealedByUser, user) &&
          !Object.prototype.hasOwnProperty.call(prev.pendingByUser, user)
        ) {
          return prev
        }
        const nextRevealed = { ...prev.revealedByUser }
        const nextPending = { ...prev.pendingByUser }
        delete nextRevealed[user]
        delete nextPending[user]
        return {
          revealedByUser: nextRevealed,
          pendingByUser: nextPending,
        }
      })
    },
  },
})

export type GradeGachaStoreInstance = StoreInstance<
  GradeGachaState,
  typeof gradeGachaStore.spec.actions
>
