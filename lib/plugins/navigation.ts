import type { AcademicCapabilities } from "@orahako/plugin-sdk/academic"
import { supportsPlugin } from "@orahako/plugin-sdk/provider-capabilities"
import { pluginPageHref } from "@orahako/plugin-sdk/ui"

export function hasPluginCapability(
  capabilities: AcademicCapabilities | undefined,
  capability: string | undefined
): boolean {
  return !capability || (capabilities as Record<string, boolean> | undefined)?.[capability] === true
}

/** A registered plugin page, reduced to what semantic navigation needs. */
export interface SemanticPageInput {
  pluginId: string
  id: string
  /** Stable semantic route (e.g. `schedule`) declared by the plugin. */
  route?: string
  primary?: boolean
  root?: boolean
  capability?: string
}

/** A registered plugin navigation entry, reduced to what semantic navigation needs. */
export interface SemanticNavigationInput {
  pluginId: string
  id: string
  page: string
  title?: string
  order?: number
  primary?: boolean
  root?: boolean
  capability?: string
}

export interface SemanticNavSources {
  pages: readonly SemanticPageInput[]
  navigation: readonly SemanticNavigationInput[]
  capabilities?: AcademicCapabilities
  /** Provider-level plugin allowlist; omitted means every plugin is allowed. */
  supportedPlugins?: readonly string[]
}

export interface SemanticNavTarget {
  pluginId: string
  pageId: string
}

/** A core-owned page that always exists; used when no plugin page resolves. */
export const CORE_DASHBOARD_FALLBACK_HREF = "/dashboard/me"

function pageKey(entry: { pluginId: string; id?: string; page?: string; pageId?: string }): string {
  return `${entry.pluginId}:${entry.pageId ?? entry.page ?? entry.id ?? ""}`
}

function navRank(
  sources: SemanticNavSources
): (page: SemanticPageInput) => [number, string, string, string] {
  const navByKey = new Map(sources.navigation.map((item) => [pageKey(item), item]))
  return (page) => {
    const nav = navByKey.get(pageKey(page))
    return [nav?.order ?? Number.POSITIVE_INFINITY, nav?.title ?? "", page.pluginId, page.id]
  }
}

function compareRank(
  a: [number, string, string, string],
  b: [number, string, string, string]
): number {
  return (
    a[0] - b[0] || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]) || a[3].localeCompare(b[3])
  )
}

function pageAvailable(sources: SemanticNavSources, page: SemanticPageInput): boolean {
  if (!supportsPlugin(sources.supportedPlugins, page.pluginId)) return false
  if (!hasPluginCapability(sources.capabilities, page.capability)) return false
  const declared = sources.navigation.find((item) => pageKey(item) === pageKey(page))
  return !declared || hasPluginCapability(sources.capabilities, declared.capability)
}

/**
 * Resolve a semantic id (e.g. `schedule`, `overview`, `student-info`) to a concrete
 * plugin page: first a page declaring that route, then a navigation entry with that
 * id. The pick is deterministic when several plugins claim the same id.
 */
export function resolveSemanticTarget(
  id: string,
  sources: SemanticNavSources
): SemanticNavTarget | undefined {
  const byRoute = sources.pages.filter((page) => page.route === id && pageAvailable(sources, page))
  if (byRoute.length > 0) {
    const rank = navRank(sources)
    const pick = [...byRoute].sort((a, b) => compareRank(rank(a), rank(b)))[0]
    return { pluginId: pick.pluginId, pageId: pick.id }
  }
  const byNav = [...sources.navigation.filter((item) => item.id === id)].sort((a, b) =>
    compareRank(
      [a.order ?? Number.POSITIVE_INFINITY, a.title ?? "", a.pluginId, a.page],
      [b.order ?? Number.POSITIVE_INFINITY, b.title ?? "", b.pluginId, b.page]
    )
  )
  for (const item of byNav) {
    if (!supportsPlugin(sources.supportedPlugins, item.pluginId)) continue
    if (!hasPluginCapability(sources.capabilities, item.capability)) continue
    const page = sources.pages.find((candidate) => pageKey(candidate) === pageKey(item))
    if (!page || !pageAvailable(sources, page)) continue
    return { pluginId: item.pluginId, pageId: item.page }
  }
  return undefined
}

/**
 * The deterministic dashboard home: the first available `primary` page (then `root`),
 * ordered by navigation order, then title, then plugin/page ids.
 */
export function resolvePrimaryTarget(sources: SemanticNavSources): SemanticNavTarget | undefined {
  const rank = navRank(sources)
  const available = sources.pages.filter((page) => pageAvailable(sources, page))
  const primary = available.filter(
    (page) =>
      page.primary ||
      sources.navigation.some((item) => pageKey(item) === pageKey(page) && item.primary)
  )
  const root = available.filter(
    (page) =>
      page.root || sources.navigation.some((item) => pageKey(item) === pageKey(page) && item.root)
  )
  const candidates = primary.length > 0 ? primary : root
  const pick = candidates
    .map((page) => ({ page, key: rank(page) }))
    .sort((a, b) => compareRank(a.key, b.key))[0]?.page
  return pick ? { pluginId: pick.pluginId, pageId: pick.id } : undefined
}

export function semanticTargetHref(target: SemanticNavTarget): string {
  return pluginPageHref(target.pluginId, target.pageId)
}

/**
 * Landing preference (`overview` | `schedule`) kept as a semantic id: resolve the
 * preferred target, fall back to the deterministic primary, then to a core page.
 */
export function landingPreferenceHref(preference: string, sources: SemanticNavSources): string {
  const target = resolveSemanticTarget(preference, sources) ?? resolvePrimaryTarget(sources)
  return target ? semanticTargetHref(target) : CORE_DASHBOARD_FALLBACK_HREF
}
