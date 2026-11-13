"use client"

import { createContext, useContext } from "react"
import type { PluginHost } from "@/lib/plugins/host"

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
