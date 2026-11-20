"use client"

import { PluginHost } from "@orahako/kernel"
import { KernelRecovery, OrahakoApp } from "@orahako/runtime-slots"
import { useEffect, useState } from "react"

export function AppComposition() {
  const [host, setHost] = useState<PluginHost>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let instance: PluginHost | undefined
    let boot: Promise<void> | undefined

    async function start() {
      try {
        const [{ officialCompositionSource }, { platformModules }] = await Promise.all([
          import("./source"),
          import("./platform-modules"),
        ])
        if (cancelled) return

        instance = new PluginHost(officialCompositionSource, { platformModules })
        boot = instance.bootstrap()
        await boot
        if (!cancelled) setHost(instance)
      } catch (failure) {
        if (!cancelled) {
          instance?.dispose()
          instance = undefined
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      if (boot) {
        // Let an in-flight bootstrap settle before disposing its package store and runtime.
        const dispose = () => instance?.dispose()
        void boot.then(dispose, dispose)
      } else {
        instance?.dispose()
      }
    }
  }, [])

  if (host) return <OrahakoApp host={host} />
  if (error !== undefined) return <KernelRecovery message={error} />
  return (
    <main className="grid min-h-dvh place-items-center p-6" role="status">
      正在启动应用…
    </main>
  )
}
