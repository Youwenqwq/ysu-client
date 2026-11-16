"use client"

import { useCallback, useSyncExternalStore } from "react"
import { usePluginServices } from "@/components/plugin-context"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"
import { useSessionSnapshot } from "./use-session"

export function useProviderAccount() {
  const { provider } = usePluginServices<AcademicPluginContext>()
  const session = useSessionSnapshot()
  const providerSnapshot = useSyncExternalStore(
    useCallback((listener) => provider.subscribe(listener), [provider]),
    useCallback(() => provider.getSnapshot(), [provider]),
    useCallback(() => provider.getSnapshot(), [provider])
  )
  const { schoolId, generation } = providerSnapshot
  return {
    session,
    schoolId,
    generation,
    /** Cache identity: a new provider generation invalidates old queries. */
    providerScope: `${schoolId ?? "none"}:${generation}`,
  }
}
