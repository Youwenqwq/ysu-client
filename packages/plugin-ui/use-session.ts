"use client"

import { useCallback, useSyncExternalStore } from "react"
import { usePluginServices } from "@/components/plugin-context"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"

export function useSessionSnapshot() {
  const { session } = usePluginServices<AcademicPluginContext>()
  return useSyncExternalStore(
    useCallback((listener) => session.subscribe(listener), [session]),
    useCallback(() => session.getSnapshot(), [session]),
    useCallback(() => session.getSnapshot(), [session])
  )
}
