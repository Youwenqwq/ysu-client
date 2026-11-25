"use client"

import { PluginHost } from "@orahako/kernel"
import { KernelRecovery, OrahakoApp } from "@orahako/runtime-slots"
import { useCallback, useEffect, useState } from "react"

import { BootSplash } from "./boot-splash"

/**
 * Wait until the browser has painted at least one frame so `BootSplash`'s
 * static textures are rasterized and its CSS animations are handed off to the
 * GPU compositor thread before heavy module evaluation and bootstrap start.
 */
function waitForFirstPaint(): Promise<void> {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0)
      })
    })
  })
}

export function AppComposition() {
  const [host, setHost] = useState<PluginHost>()
  const [error, setError] = useState<string>()
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashExiting, setSplashExiting] = useState(false)

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
        await waitForFirstPaint()
        if (cancelled) return

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

  // Start the splash exit transition on the frame after OrahakoApp commits so
  // the initial app mount does not compete with the fade-out frames.
  useEffect(() => {
    if (!host || !splashVisible) return
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setSplashExiting(true)
      return
    }
    const frame = window.requestAnimationFrame(() => {
      setSplashExiting(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [host, splashVisible])

  const handleSplashExited = useCallback(() => {
    setSplashVisible(false)
  }, [])

  if (error !== undefined) return <KernelRecovery message={error} />
  if (host) {
    return (
      <>
        <OrahakoApp host={host} />
        {splashVisible && (
          <BootSplash overlay exiting={splashExiting} onExited={handleSplashExited} />
        )}
      </>
    )
  }
  return <BootSplash />
}
