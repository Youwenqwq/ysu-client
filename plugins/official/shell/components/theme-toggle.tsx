"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { Button } from "@orahako/plugin-ui/components"
import { useTranslation } from "@/plugins/official/runtime/i18n/use-translation"

/**
 * Theme toggle that owns its next-themes subscription.
 *
 * Header slots keep the element instance created when the slot was registered, so an
 * `onClick` built by the page keeps reading the theme captured in that render. Keeping the
 * subscription inside the element means every click reads the current theme; toggling from
 * `system` always lands on the explicit opposite of what is rendered, so the first click is
 * also visible.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const { t } = useTranslation()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return null
  }

  const isDark = resolvedTheme === "dark"

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={t("app.theme")}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}
