"use client"

import { useSyncExternalStore } from "react"
import type { PluginUIRegistryService } from "@orahako/plugin-sdk"

export function usePluginUI(registry: PluginUIRegistryService) {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
}
