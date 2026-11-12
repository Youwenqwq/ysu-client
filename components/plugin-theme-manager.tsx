"use client"

import { useEffect } from "react"
import { usePluginHost } from "./plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"

export function PluginThemeManager() {
  const { host, isReady } = usePluginHost()
  const { themes } = usePluginUI(host.ui)
  const activeTheme = usePluginPreferences((state) => state.activeTheme)
  const setActiveTheme = usePluginPreferences((state) => state.setActiveTheme)
  const theme = themes.find((item) => `${item.pluginId}:${item.id}` === activeTheme)

  useEffect(() => {
    if (isReady && activeTheme && !theme) setActiveTheme(undefined)
  }, [activeTheme, isReady, setActiveTheme, theme])

  if (!theme) return null
  return <style data-plugin-theme={`${theme.pluginId}:${theme.id}`}>{theme.css}</style>
}
