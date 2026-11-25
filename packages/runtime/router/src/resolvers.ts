import {
  isAppNavigation,
  pluginPageHref,
  type NavigationFilter,
  type NavigationFilterContext,
  type PluginNavigationScope,
} from "@orahako/sdk"

export interface SemanticPageInput {
  readonly pluginId: string
  readonly id: string
  readonly route?: string
  readonly parent?: string
  readonly primary?: boolean
  readonly root?: boolean
  readonly capability?: string
  readonly requiresProvider?: boolean
}

export interface SemanticNavigationInput {
  readonly pluginId: string
  readonly id: string
  readonly page: string
  readonly params?: Readonly<Record<string, string | number>>
  readonly scope?: PluginNavigationScope
  readonly title?: string
  readonly titleKey?: string
  readonly order?: number
  readonly primary?: boolean
  readonly root?: boolean
  readonly capability?: string
}

export interface SemanticNavSources {
  readonly pages: readonly SemanticPageInput[]
  readonly navigation: readonly SemanticNavigationInput[]
  readonly filters?: readonly NavigationFilter[]
  readonly fallbackHref?: string
}

export interface SemanticNavTarget {
  readonly pluginId: string
  readonly pageId: string
}

export type NavigationLocationParams =
  | Readonly<Record<string, string | undefined>>
  | Pick<URLSearchParams, "get">

export interface PluginNavigationLocation {
  readonly pluginId: string
  readonly pageId: string
  readonly params?: NavigationLocationParams
}

function passesFilters(
  filters: readonly NavigationFilter[] | undefined,
  context: NavigationFilterContext
): boolean {
  if (!filters || filters.length === 0) return true
  return filters.every((filter) => filter(context))
}

function pageKey(entry: {
  readonly pluginId: string
  readonly id?: string
  readonly page?: string
  readonly pageId?: string
}): string {
  return `${entry.pluginId}:${entry.pageId ?? entry.page ?? entry.id ?? ""}`
}

function readLocationParam(
  params: NavigationLocationParams | undefined,
  key: string
): string | null | undefined {
  if (!params) return undefined
  if ("get" in params && typeof params.get === "function") {
    return params.get(key)
  }
  return (params as Readonly<Record<string, string | undefined>>)[key]
}

function navigationParamsMatch(
  item: Pick<SemanticNavigationInput, "params">,
  params: NavigationLocationParams | undefined
): boolean {
  if (!item.params) return true
  if (!params) return false
  return Object.entries(item.params).every(
    ([key, value]) => readLocationParam(params, key) === String(value)
  )
}

function navigationAvailable(
  sources: Pick<SemanticNavSources, "pages" | "filters">,
  item: SemanticNavigationInput
): boolean {
  const targetPage = sources.pages?.find((candidate) => pageKey(candidate) === pageKey(item))
  return passesFilters(sources.filters, {
    pluginId: item.pluginId,
    ...(item.capability !== undefined ? { capability: item.capability } : {}),
    ...(targetPage?.requiresProvider !== undefined
      ? { requiresProvider: targetPage.requiresProvider }
      : {}),
  })
}

export function navigationForScope<T extends SemanticNavigationInput>(
  navigation: readonly T[],
  scope: "app",
  sources?: Partial<Pick<SemanticNavSources, "pages" | "filters">>,
  pluginId?: string
): Exclude<T, { scope: "plugin" }>[]
export function navigationForScope<T extends SemanticNavigationInput>(
  navigation: readonly T[],
  scope: "plugin",
  sources?: Partial<Pick<SemanticNavSources, "pages" | "filters">>,
  pluginId?: string
): T[]
export function navigationForScope<T extends SemanticNavigationInput>(
  navigation: readonly T[],
  scope: PluginNavigationScope,
  sources: Partial<Pick<SemanticNavSources, "pages" | "filters">> = {},
  pluginId?: string
): T[] {
  const filterSources = {
    pages: sources.pages ?? [],
    filters: sources.filters,
  }
  return navigation
    .filter(
      (item) =>
        (item.scope ?? "app") === scope &&
        (scope === "app" || item.pluginId === pluginId) &&
        navigationAvailable(filterSources, item)
    )
    .sort(
      (a, b) =>
        (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) ||
        a.id.localeCompare(b.id)
    )
}

export function resolveMobileNavigation<T extends SemanticNavigationInput>(
  navigation: readonly T[],
  activePluginId: string | undefined,
  sources: Partial<Pick<SemanticNavSources, "pages" | "filters">> = {}
): { scope: PluginNavigationScope; items: T[] } {
  const pluginItems = activePluginId
    ? navigationForScope(navigation, "plugin", sources, activePluginId)
    : []
  if (pluginItems.length > 0) {
    return { scope: "plugin", items: pluginItems }
  }
  return {
    scope: "app",
    items: navigationForScope(navigation, "app", sources).filter((item) => item.primary),
  }
}

export function isPrimaryNavigationLocation(
  navigation: readonly SemanticNavigationInput[],
  location: PluginNavigationLocation
): boolean {
  return navigation.some(
    (item) =>
      item.pluginId === location.pluginId &&
      item.page === location.pageId &&
      (isAppNavigation(item) ? item.primary === true : true) &&
      navigationParamsMatch(item, location.params)
  )
}

export function resolveActivePluginNavigation(
  navigation: readonly SemanticNavigationInput[],
  pages: readonly SemanticPageInput[],
  location: PluginNavigationLocation
): string | undefined {
  const items = navigation.filter(
    (item) => item.pluginId === location.pluginId && !isAppNavigation(item)
  )
  const select = (pageId: string): string | undefined => {
    const candidates = items.filter((item) => item.page === pageId)
    return (
      candidates.find((item) => navigationParamsMatch(item, location.params)) ?? candidates[0]
    )?.id
  }

  const direct = select(location.pageId)
  if (direct) return direct

  const visited = new Set<string>([location.pageId])
  let page = pages.find(
    (item) => item.pluginId === location.pluginId && item.id === location.pageId
  )
  while (page?.parent && !visited.has(page.parent)) {
    const parentId = page.parent
    const matchedParent = select(parentId)
    if (matchedParent) return matchedParent
    visited.add(parentId)
    page = pages.find((item) => item.pluginId === location.pluginId && item.id === parentId)
  }
  return undefined
}

function navRank(
  sources: SemanticNavSources
): (page: SemanticPageInput) => [number, string, string, string] {
  const navByKey = new Map(
    sources.navigation.filter(isAppNavigation).map((item) => [pageKey(item), item])
  )
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

export function pageAvailable(sources: SemanticNavSources, page: SemanticPageInput): boolean {
  if (
    !passesFilters(sources.filters, {
      pluginId: page.pluginId,
      ...(page.capability !== undefined ? { capability: page.capability } : {}),
      ...(page.requiresProvider !== undefined ? { requiresProvider: page.requiresProvider } : {}),
    })
  ) {
    return false
  }
  const declared = sources.navigation.find(
    (item) => isAppNavigation(item) && pageKey(item) === pageKey(page)
  )
  if (!declared) return true
  return passesFilters(sources.filters, {
    pluginId: declared.pluginId,
    ...(declared.capability !== undefined ? { capability: declared.capability } : {}),
    ...(page.requiresProvider !== undefined ? { requiresProvider: page.requiresProvider } : {}),
  })
}

export function resolveSemanticTarget(
  id: string,
  sources: SemanticNavSources
): SemanticNavTarget | undefined {
  const byRoute = sources.pages.filter((page) => page.route === id && pageAvailable(sources, page))
  if (byRoute.length > 0) {
    const rank = navRank(sources)
    const pick = [...byRoute].sort((a, b) => compareRank(rank(a), rank(b)))[0]!
    return { pluginId: pick.pluginId, pageId: pick.id }
  }

  const byNav = sources.navigation
    .filter((item) => isAppNavigation(item) && item.id === id)
    .sort((a, b) =>
      compareRank(
        [a.order ?? Number.POSITIVE_INFINITY, a.title ?? "", a.pluginId, a.page],
        [b.order ?? Number.POSITIVE_INFINITY, b.title ?? "", b.pluginId, b.page]
      )
    )

  for (const item of byNav) {
    if (!navigationAvailable(sources, item)) continue
    const page = sources.pages.find((candidate) => pageKey(candidate) === pageKey(item))
    if (!page || !pageAvailable(sources, page)) continue
    return { pluginId: item.pluginId, pageId: item.page }
  }
  return undefined
}

export function resolvePrimaryTarget(sources: SemanticNavSources): SemanticNavTarget | undefined {
  const rank = navRank(sources)
  const available = sources.pages.filter((page) => pageAvailable(sources, page))
  const primary = available.filter(
    (page) =>
      page.primary ||
      sources.navigation.some(
        (item) => isAppNavigation(item) && pageKey(item) === pageKey(page) && item.primary
      )
  )
  const root = available.filter(
    (page) =>
      page.root ||
      sources.navigation.some(
        (item) => isAppNavigation(item) && pageKey(item) === pageKey(page) && item.root
      )
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

export function landingPreferenceHref(preference: string, sources: SemanticNavSources): string {
  const target = resolveSemanticTarget(preference, sources) ?? resolvePrimaryTarget(sources)
  return target ? semanticTargetHref(target) : (sources.fallbackHref ?? "")
}
