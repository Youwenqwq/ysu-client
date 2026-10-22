"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { harmonyCall, isHarmony } from "@/lib/native/harmony"

function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <HarmonyAppearanceSync />
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function HarmonyAppearanceSync() {
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    if (!isHarmony()) return
    let active = true
    let revision = 0
    const syncSafeArea = () => {
      const current = ++revision
      void harmonyCall<Record<"top" | "right" | "bottom" | "left", number>>(
        "appearance.getSafeArea"
      )
        .then((insets) => {
          if (!active || current !== revision) return
          const edges = ["top", "right", "bottom", "left"] as const
          if (edges.some((edge) => !Number.isFinite(insets[edge]) || insets[edge] < 0)) return
          const ratio = window.devicePixelRatio || 1
          const root = document.documentElement
          for (const edge of edges) {
            root.style.setProperty(`--safe-area-inset-${edge}`, `${insets[edge] / ratio}px`)
          }
          root.setAttribute("data-harmony-edge-to-edge", "true")
        })
        .catch(() => {})
    }
    syncSafeArea()
    window.addEventListener("resize", syncSafeArea)
    window.addEventListener("ysu-native-safe-area", syncSafeArea)
    return () => {
      active = false
      window.removeEventListener("resize", syncSafeArea)
      window.removeEventListener("ysu-native-safe-area", syncSafeArea)
    }
  }, [])

  React.useEffect(() => {
    if (!isHarmony() || (resolvedTheme !== "light" && resolvedTheme !== "dark")) return

    void harmonyCall("appearance.setTheme", { theme: resolvedTheme }).catch(() => {})
  }, [resolvedTheme])

  return null
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
