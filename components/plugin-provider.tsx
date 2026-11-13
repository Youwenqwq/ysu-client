"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { getPluginHost } from "@/lib/plugins/host"
import { PluginSlotRuntimeProvider } from "./plugin-slot-runtime"
import { PluginReactContext, usePluginHost } from "./plugin-context"

export { usePluginHost }

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const host = getPluginHost()
  const [isReady, setReady] = useState(false)

  useEffect(() => {
    let active = true
    void host.bootstrap().then(
      () => {
        if (active) setReady(true)
      },
      (error) => {
        host.bootstrapError = error instanceof Error ? error.message : String(error)
        if (active) setReady(true)
      }
    )
    return () => {
      active = false
    }
  }, [host])

  const value = useMemo(() => ({ host, isReady }), [host, isReady])
  return (
    <PluginReactContext.Provider value={value}>
      <PluginSlotRuntimeProvider registry={host.slots}>
        {isReady ? children : <div className="min-h-svh bg-background" />}
      </PluginSlotRuntimeProvider>
    </PluginReactContext.Provider>
  )
}

export function usePluginStates() {
  const { host } = usePluginHost()
  return useSyncExternalStore(
    host.runtime.subscribe,
    host.runtime.getSnapshot.bind(host.runtime),
    host.runtime.getSnapshot.bind(host.runtime)
  )
}
