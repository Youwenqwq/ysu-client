"use client"

import { Suspense, useEffect, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { isAppNavigation } from "@orahako/plugin-sdk"
import { officialCompositionSource } from "@/plugins/official/composition"
import { I18nProvider } from "@/plugins/official/runtime/i18n/context"
import { usePluginRouteStore } from "@/plugins/official/shell/stores/plugin-route"
import { PluginProvider, usePluginHost } from "@/components/plugin-provider"
import { PluginShell } from "@/components/plugin-shell"
import { PluginThemeManager } from "@/plugins/official/shell/components/plugin-theme-manager"
import { PwaRegister } from "@/plugins/official/shell/components/pwa-register"
import { PwaUpdatePrompt } from "@/plugins/official/shell/components/pwa-update-prompt"
import { ThemeProvider } from "@/components/theme-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"

/**
 * Official shell-owned bookkeeping: mirror the active plugin route into the
 * shell store so dashboard chrome (title, fullscreen request, back behaviour)
 * observes navigation without the generic route host knowing about it.
 */
function PluginRouteObserver() {
  const { host } = usePluginHost()
  const { pages, navigation } = usePluginUI(host.ui)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const setCurrent = usePluginRouteStore((state) => state.setCurrent)

  const isPluginRoute = pathname.replace(/\/+$/, "") === "/dashboard/plugin"
  const pluginId = searchParams.get("plugin")
  const pageId = searchParams.get("page") ?? "index"
  const semanticRoute = searchParams.get("route")
  const semanticTarget =
    isPluginRoute && semanticRoute ? host.navigation.resolve(semanticRoute) : undefined
  const requestedPluginId = semanticTarget?.pluginId ?? pluginId
  const requestedPageId = semanticTarget?.pageId ?? pageId
  const page =
    isPluginRoute && requestedPluginId
      ? pages.find((item) => item.pluginId === requestedPluginId && item.id === requestedPageId)
      : undefined
  const primary = page
    ? page.primary ||
      navigation.some(
        (item) =>
          isAppNavigation(item) &&
          item.pluginId === page.pluginId &&
          item.page === page.id &&
          item.primary
      )
    : undefined

  useEffect(() => {
    if (!page) {
      setCurrent(undefined)
      return
    }
    setCurrent({
      pluginId: page.pluginId,
      pageId: page.id,
      title: page.title,
      titleKey: page.titleKey,
      parent: page.parent,
      primary,
      capability: page.capability,
      fullscreen: page.fullscreen,
    })
    return () => setCurrent(undefined)
  }, [page, primary, setCurrent])

  return null
}

/**
 * Application composition root. This is the only place that selects the
 * official shell, runtime and i18n provider; generic kernel entries render its
 * children without importing an official implementation.
 */
function CompositionI18nProvider({ children }: { children: ReactNode }) {
  const { host } = usePluginHost()
  return <I18nProvider registry={host.i18n}>{children}</I18nProvider>
}

export function AppComposition({ children }: { children: ReactNode }) {
  return (
    <PluginProvider source={officialCompositionSource}>
      <CompositionI18nProvider>
        <Suspense fallback={null}>
          <PluginRouteObserver />
        </Suspense>
        <PwaRegister />
        <PwaUpdatePrompt />
        <ThemeProvider>
          <PluginThemeManager />
          <PluginShell>{children}</PluginShell>
        </ThemeProvider>
      </CompositionI18nProvider>
    </PluginProvider>
  )
}
