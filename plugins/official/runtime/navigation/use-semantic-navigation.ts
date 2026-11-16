"use client"

import { useMemo, useSyncExternalStore } from "react"
import {
  pluginPageHref,
  type AcademicPluginContext,
  type NavigationSources,
  type NavigationTarget,
} from "@orahako/plugin-sdk"
import { usePluginServices } from "@orahako/plugin-ui/services"

export interface SemanticNav {
  /** Live navigation sources exposed to pure registry consumers. */
  sources: NavigationSources
  /** Resolve any registered semantic route or navigation id to its concrete page. */
  target(id: string): NavigationTarget | undefined
  /** Resolved href, or null when the semantic id has no live plugin page. */
  href(id: string): string | null
  /** The deterministic dashboard home, then the composition fallback. */
  primaryHref(): string
}

/**
 * Live semantic navigation resolved through the scoped navigation service.
 *
 * The hook reads the services bridge supplied by the selected shell; it never
 * imports the navigation registry or provider runtime implementations.
 */
export function useSemanticNavigation(): SemanticNav {
  const services = usePluginServices<AcademicPluginContext>()
  const navigation = services.navigation
  const provider = services.provider
  const ui = services.ui
  const providerSnapshot = useSyncExternalStore(
    provider.subscribe,
    provider.getSnapshot,
    provider.getSnapshot
  )
  const uiSnapshot = useSyncExternalStore(ui.subscribe, ui.getSnapshot, ui.getSnapshot)

  return useMemo(() => {
    void providerSnapshot
    void uiSnapshot
    // Re-read the service snapshot after either root registry publishes.
    const sources = navigation.sources()
    return {
      sources,
      target: (id) => navigation.resolve(id),
      href: (id) => {
        const target = navigation.resolve(id)
        return target ? pluginPageHref(target.pluginId, target.pageId) : null
      },
      primaryHref: () => {
        const target = navigation.primary()
        return target
          ? pluginPageHref(target.pluginId, target.pageId)
          : (sources.fallbackHref ?? "")
      },
    }
  }, [navigation, providerSnapshot, uiSnapshot])
}
