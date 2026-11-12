"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { getPluginHost, type PluginHost } from "@/lib/plugins/host"

interface PluginProviderValue {
  host: PluginHost
  isReady: boolean
}

const PluginContext = createContext<PluginProviderValue | null>(null)

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const host = getPluginHost()
  const [isReady, setReady] = useState(false)

  useEffect(() => {
    let active = true
    void host.bootstrap().then(() => {
      if (active) setReady(true)
    })
    return () => {
      active = false
    }
  }, [host])

  const value = useMemo(() => ({ host, isReady }), [host, isReady])
  return (
    <PluginContext.Provider value={value}>
      {isReady ? children : <div className="min-h-svh bg-background" />}
    </PluginContext.Provider>
  )
}

export function usePluginHost(): PluginProviderValue {
  const context = useContext(PluginContext)
  if (!context) throw new Error("usePluginHost must be used within PluginProvider")
  return context
}

export function usePluginStates() {
  const { host } = usePluginHost()
  return useSyncExternalStore(
    host.runtime.subscribe,
    host.runtime.getSnapshot.bind(host.runtime),
    host.runtime.getSnapshot.bind(host.runtime)
  )
}
