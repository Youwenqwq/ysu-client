"use client"

import { useMemo } from "react"
import { usePluginHost } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { useProviderCapabilities } from "@/providers/use-provider"
import {
  resolvePrimaryTarget,
  resolveSemanticTarget,
  semanticTargetHref,
  type SemanticNavSources,
  type SemanticNavTarget,
} from "@/lib/plugins/navigation"

export interface SemanticNav {
  /** Live registry snapshot for the pure resolvers in `lib/plugins/navigation`. */
  sources: SemanticNavSources
  /** Resolve a semantic id (`schedule`, `student-info`, …) to a live plugin page. */
  target(id: string): SemanticNavTarget | undefined
  /** Resolved href, or null when the semantic id has no live plugin page. */
  href(id: string): string | null
  /** The deterministic dashboard home href (primary page, or a core fallback). */
  primaryHref(): string
}

/** Live semantic navigation resolved from the plugin UI registry on every render. */
export function useSemanticNavigation(): SemanticNav {
  const { host, isReady } = usePluginHost()
  const { pages, navigation } = usePluginUI(host.ui)
  const capabilities = useProviderCapabilities()

  return useMemo(() => {
    const sources: SemanticNavSources = {
      pages: isReady ? pages : [],
      navigation: isReady ? navigation : [],
      capabilities,
    }
    return {
      sources,
      target: (id) => resolveSemanticTarget(id, sources),
      href: (id) => {
        const target = resolveSemanticTarget(id, sources)
        return target ? semanticTargetHref(target) : null
      },
      primaryHref: () => {
        const target = resolvePrimaryTarget(sources)
        return target ? semanticTargetHref(target) : "/dashboard/me"
      },
    }
  }, [isReady, pages, navigation, capabilities])
}
