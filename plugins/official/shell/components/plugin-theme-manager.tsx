"use client"

import { useEffect } from "react"
import { usePluginUI } from "@orahako/plugin-ui/services"
import { usePluginManager } from "@orahako/plugin-ui/shell"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"

export function PluginThemeManager() {
  const { isReady } = usePluginManager()
  const { themes } = usePluginUI()
  const activeTheme = useSettingsStore((state) => state.activeTheme)
  const setActiveTheme = useSettingsStore((state) => state.setActiveTheme)
  const theme = themes.find((item) => `${item.pluginId}:${item.id}` === activeTheme)

  useEffect(() => {
    if (isReady && activeTheme && !theme) setActiveTheme(undefined)
  }, [activeTheme, isReady, setActiveTheme, theme])

  if (!theme) return null
  return <style data-plugin-theme={`${theme.pluginId}:${theme.id}`}>{theme.css}</style>
}
