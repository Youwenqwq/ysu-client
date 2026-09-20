"use client"

import { useCallback, useEffect, useMemo } from "react"
import type { Course, CurrentWeek, TermCalendar } from "@/providers/types"
import {
  resolveSchedulePatches,
  resolveScheduleTerm,
  type ScheduleIssue,
  type SchedulePatch,
} from "@/lib/academic/schedule-patches"
import { getSchoolConfigScope } from "@/lib/server-config"
import { useAuthStore } from "@/lib/stores/auth"
import { hydrateSchedulePatches, useSchedulePatchesStore } from "@/lib/stores/schedule-patches"
import { useProvider, useProviderReady } from "@/providers/use-provider"

const EMPTY_PATCHES: SchedulePatch[] = []
const BLOCKING_ISSUES: Partial<Record<ScheduleIssue["reason"], true>> = {
  invalidDate: true,
  invalidSections: true,
  missingDependency: true,
  dependencyCycle: true,
  targetChanged: true,
  patchConflict: true,
}

export function useEffectiveSchedule(
  rawCourses: Course[] | undefined,
  calendar: TermCalendar | undefined,
  currentWeek: CurrentWeek | null,
  requestedSemester?: string
) {
  const provider = useProvider()
  const providerReady = useProviderReady()
  const username = useAuthStore((state) => state.username)
  const authHydrated = useAuthStore((state) => state.hasHydrated)
  const schoolScope = getSchoolConfigScope()
  const term = useMemo(
    () => resolveScheduleTerm(calendar, currentWeek, requestedSemester),
    [calendar, currentWeek, requestedSemester]
  )
  const scope =
    providerReady && authHydrated && username && term
      ? JSON.stringify([provider.id, schoolScope, username, term.semester])
      : null
  const hasHydrated = useSchedulePatchesStore((state) => state.hasHydrated)
  const patches = useSchedulePatchesStore((state) =>
    scope ? (state.byScope[scope] ?? EMPTY_PATCHES) : EMPTY_PATCHES
  )
  const ready = !!scope && hasHydrated && rawCourses !== undefined

  useEffect(() => {
    void hydrateSchedulePatches()
  }, [])

  const result = useMemo(
    () =>
      ready && term && rawCourses
        ? resolveSchedulePatches(rawCourses, term.termStartDate, term.totalWeeks, patches)
        : { courses: [], traces: [], issues: [] },
    [ready, term, rawCourses, patches]
  )

  const assertReady = useCallback(() => {
    if (
      !ready ||
      !scope ||
      !term ||
      rawCourses === undefined ||
      useAuthStore.getState().username !== username ||
      getSchoolConfigScope() !== schoolScope
    ) {
      throw new Error("scheduleEditor.notReady")
    }
    return { scope, term, rawCourses }
  }, [ready, scope, term, rawCourses, username, schoolScope])

  const assertApplicable = useCallback(
    (id: string, candidate: SchedulePatch[]) => {
      const current = assertReady()
      const resolved = resolveSchedulePatches(
        current.rawCourses,
        current.term.termStartDate,
        current.term.totalWeeks,
        candidate
      )
      const blocked = resolved.issues.find(
        (issue) => issue.patchId === id && BLOCKING_ISSUES[issue.reason]
      )
      if (blocked) throw new Error(`scheduleEditor.issue_${blocked.reason}`)
      const stored = useSchedulePatchesStore.getState().byScope[current.scope] ?? EMPTY_PATCHES
      const baseline = resolveSchedulePatches(
        current.rawCourses,
        current.term.termStartDate,
        current.term.totalWeeks,
        stored
      )
      if (
        resolved.issues.some(
          (issue) =>
            issue.patchId !== id &&
            BLOCKING_ISSUES[issue.reason] &&
            !baseline.issues.some(
              (old) => old.patchId === issue.patchId && old.reason === issue.reason
            )
        )
      ) {
        throw new Error("scheduleEditor.issue_patchConflict")
      }
      const patch = candidate.find((item) => item.id === id)
      if (
        patch &&
        ((patch.source.length === 0 && patch.mode !== "clear") ||
          (patch.kind === "course" && patch.source.length !== 1) ||
          new Set(patch.source.map((item) => item.occurrenceId)).size !== patch.source.length)
      ) {
        throw new Error("scheduleEditor.issue_sourceAmbiguous")
      }
    },
    [assertReady]
  )

  const addPatch = useCallback(
    (draft: Omit<SchedulePatch, "id" | "createdAt" | "enabled">): string => {
      const current = assertReady()
      const stored = useSchedulePatchesStore.getState().byScope[current.scope] ?? EMPTY_PATCHES
      const timestamp = Math.max(
        Date.now(),
        ...stored.map((item) => Date.parse(item.createdAt) + 1)
      )
      const patch: SchedulePatch = structuredClone({
        ...draft,
        id: crypto.randomUUID(),
        createdAt: new Date(timestamp).toISOString(),
        enabled: true,
        dependsOn: [
          ...new Set([
            ...draft.dependsOn,
            ...draft.source.flatMap((item) => item.patchIds),
            ...draft.replaced.flatMap((item) => item.patchIds),
          ]),
        ],
      })
      assertApplicable(patch.id, [...stored, patch])
      useSchedulePatchesStore.getState().add(current.scope, patch)
      return patch.id
    },
    [assertReady, assertApplicable]
  )

  const removePatch = useCallback(
    (id: string) => {
      const current = assertReady()
      useSchedulePatchesStore.getState().remove(current.scope, id)
    },
    [assertReady]
  )

  const setPatchEnabled = useCallback(
    (id: string, enabled: boolean) => {
      const current = assertReady()
      if (enabled) {
        const stored = useSchedulePatchesStore.getState().byScope[current.scope] ?? EMPTY_PATCHES
        assertApplicable(
          id,
          stored.map((patch) => (patch.id === id ? { ...patch, enabled } : patch))
        )
      }
      useSchedulePatchesStore.getState().setEnabled(current.scope, id, enabled)
    },
    [assertReady, assertApplicable]
  )

  return {
    scope,
    ready,
    ...result,
    patches,
    addPatch,
    removePatch,
    setPatchEnabled,
    termStartDate: term?.termStartDate ?? "",
    totalWeeks: term?.totalWeeks ?? 0,
  }
}
