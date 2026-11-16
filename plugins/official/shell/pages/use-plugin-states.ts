"use client"

import { useSyncExternalStore } from "react"
import { usePluginManager } from "@orahako/plugin-ui/shell"

/** Live plugin runtime states from the kernel plugin manager surface. */
export function usePluginStates() {
  const { subscribeRuntime, getRuntimeSnapshot } = usePluginManager()
  return useSyncExternalStore(subscribeRuntime, getRuntimeSnapshot, getRuntimeSnapshot)
}
