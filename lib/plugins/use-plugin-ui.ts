"use client"

import { useSyncExternalStore } from "react"
import type { PluginUIRegistry } from "./ui-registry"

export function usePluginUI(registry: PluginUIRegistry) {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot)
}
