"use client"

import { createContext, useContext, useMemo } from "react"

import type { PluginHost } from "@/lib/plugins/host"
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"

export interface PluginContextValue {
  host: PluginHost
  isReady: boolean
}

export const PluginReactContext = createContext<PluginContextValue | null>(null)

export function usePluginHost(): PluginContextValue {
  const context = useContext(PluginReactContext)
  if (!context) throw new Error("usePluginHost must be used within PluginProvider")
  return context
}

export {
  PluginServicesContext,
  PluginServicesProvider,
  usePluginServices,
  usePluginUI,
} from "@orahako/plugin-ui/services"

/**
 * Narrow kernel plugin-management surface for the official plugin manager.
 *
 * This is not a runtime capability: it only exposes installation, recovery and
 * enable/disable controls the kernel owns. Runtime data and native calls stay
 * on the scoped `PluginContext`.
 */
export function usePluginManager() {
  const { host, isReady } = usePluginHost()
  const preferences = usePluginPreferences()
  return useMemo(() => ({
    preferences,
    isReady,
    composition: host.composition,
    packages: host.packages,
    loadErrors: host.loadErrors,
    recovery: host.recovery,
    installFile: host.install.bind(host),
    installFromUrl: host.installFromUrl.bind(host),
    applyPluginBundle: host.applyPluginBundle.bind(host),
    enable: host.enable.bind(host),
    disable: host.disable.bind(host),
    uninstall: host.uninstall.bind(host),
    subscribeRuntime: host.runtime.subscribe,
    getRuntimeSnapshot: host.runtime.getSnapshot.bind(host.runtime),
  }), [host, isReady, preferences])
}
