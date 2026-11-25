"use client"

import { PluginHost } from "@orahako/kernel"
import { KernelRecovery, OrahakoApp } from "@orahako/runtime-slots"
import { useEffect, useState } from "react"

import { BootSplash } from "./boot-splash"

export function AppComposition() {
  const [host, setHost] = useState<PluginHost>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let instance: PluginHost | undefined
    let boot: Promise<void> | undefined

    async function disposeInstance(): Promise<void> {
      const target = instance
      if (!target) return
      try {
        await target.dispose()
      } catch (failure) {
        console.error("Failed to dispose plugin host:", failure)
      }
    }

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
          await disposeInstance()
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }
    }

    void start()
    return () => {
      cancelled = true
      if (boot) {
        // Let an in-flight bootstrap settle before disposing its package store and runtime.
        void boot.then(disposeInstance, disposeInstance)
      } else {
        void disposeInstance()
      }
    }
  }, [])

  if (host) return <OrahakoApp host={host} />
  if (error !== undefined) return <KernelRecovery message={error} />
  return <BootSplash />
}
