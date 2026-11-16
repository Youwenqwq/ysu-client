"use client"

import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import type { PluginContext } from "@orahako/plugin-sdk"

/** Scoped services supplied by the selected shell, shared by official and external UI. */
export const PluginServicesContext = createContext<PluginContext | null>(null)

export function PluginServicesProvider({
  context,
  children,
}: {
  context: PluginContext
  children: ReactNode
}) {
  return createElement(PluginServicesContext.Provider, { value: context }, children)
}

export function usePluginServices<T extends PluginContext = PluginContext>(): T {
  const context = useContext(PluginServicesContext)
  if (!context) throw new Error("usePluginServices must be used within PluginServicesProvider")
  return context as T
}

export function usePluginUI() {
  const { ui } = usePluginServices()
  return useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)
}
