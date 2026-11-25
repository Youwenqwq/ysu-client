import {
  isAppNavigation,
  pluginPageHref,
  resolveContributionText,
  type PluginAppNavigationDefinition,
  type PluginIcon,
  type PluginI18nService,
  type PluginLocale,
  type PluginNavigationContribution,
  type PluginNavigationScope,
  type PluginNavigationService,
  type PluginPageContribution,
  type RouteLocation,
  type RouteParams,
} from "@orahako/sdk"
import type { ComponentType } from "react"

export type AppNavContribution = PluginNavigationContribution & PluginAppNavigationDefinition

export interface ShellSidebarItem {
  readonly id: string
  readonly pluginId: string
  readonly pageId: string
  readonly title: string
  readonly href: string
  readonly icon: PluginIcon
  readonly isActive: boolean
  readonly onNavigate: () => void
}

export interface ShellSidebarGroup {
  readonly group: string
  readonly label: string
  readonly items: readonly ShellSidebarItem[]
}

export interface ShellMobileTab {
  readonly id: string
  readonly pluginId: string
  readonly href: string
  readonly label: string
  readonly icon: PluginIcon
  readonly badge?: ComponentType
  readonly isActive: boolean
  readonly onNavigate: () => void
}

const KNOWN_GROUP_ORDER = ["main", "academic", "platform", "fees", "extras", "plugins", "account"]

function navParamsMatch(
  paramsSpec: Readonly<Record<string, string | number>> | undefined,
  locationParams: RouteParams
): boolean {
  if (!paramsSpec) return true
  return Object.entries(paramsSpec).every(
    ([key, expected]) => locationParams[key] === String(expected)
  )
}

export function resolveActivePageForLocation(
  location: RouteLocation,
  pages: readonly PluginPageContribution[],
  navigation: Pick<PluginNavigationService, "resolve" | "primary">,
  defaultLanding: string
): PluginPageContribution | undefined {
  const findPage = (pluginId: string, pageId: string): PluginPageContribution | undefined =>
    pages.find((page) => page.pluginId === pluginId && page.id === pageId)

  if (location.route) {
    const target = navigation.resolve(location.route)
    return target ? findPage(target.pluginId, target.pageId) : undefined
  }
  if (location.pluginId) {
    return findPage(location.pluginId, location.pageId ?? "index")
  }
  const fallback =
    (defaultLanding ? navigation.resolve(defaultLanding) : undefined) ?? navigation.primary()
  return fallback ? findPage(fallback.pluginId, fallback.pageId) : undefined
}

export function isPagePrimary(
  page: PluginPageContribution,
  navigation: readonly PluginNavigationContribution[]
): boolean {
  if (page.primary) return true
  return navigation.some(
    (item) =>
      isAppNavigation(item) &&
      item.pluginId === page.pluginId &&
      item.page === page.id &&
      item.primary === true
  )
}

export function resolveActiveScopedNavId(
  scopedItems: readonly PluginNavigationContribution[],
  pages: readonly PluginPageContribution[],
  activePluginId: string,
  activePageId: string,
  params: RouteParams
): string | undefined {
  const selectForPage = (pageId: string): string | undefined => {
    const candidates = scopedItems.filter((item) => item.page === pageId)
    return (candidates.find((item) => navParamsMatch(item.params, params)) ?? candidates[0])?.id
  }

  const direct = selectForPage(activePageId)
  if (direct) return direct

  const visited = new Set<string>([activePageId])
  let cursor = pages.find((page) => page.pluginId === activePluginId && page.id === activePageId)
  while (cursor?.parent && !visited.has(cursor.parent)) {
    const parentId = cursor.parent
    const matched = selectForPage(parentId)
    if (matched) return matched
    visited.add(parentId)
    cursor = pages.find((page) => page.pluginId === activePluginId && page.id === parentId)
  }
  return undefined
}

export function buildSidebarGroups(options: {
  readonly appNav: readonly AppNavContribution[]
  readonly pages: readonly PluginPageContribution[]
  readonly activePage: PluginPageContribution | undefined
  readonly locale: PluginLocale
  readonly groupLabel: (group: string) => string
  readonly i18n: Pick<PluginI18nService, "translate">
  readonly formatHref: (rawHref: string) => string
  readonly pushTarget: (
    pluginId: string,
    pageId: string,
    params?: Readonly<Record<string, string | number>>
  ) => void
}): {
  readonly mainGroups: readonly ShellSidebarGroup[]
  readonly accountItems: readonly ShellSidebarItem[]
} {
  const grouped = new Map<string, AppNavContribution[]>()
  for (const item of options.appNav) {
    const list = grouped.get(item.group)
    if (list) list.push(item)
    else grouped.set(item.group, [item])
  }

  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => {
    const aIdx = KNOWN_GROUP_ORDER.indexOf(a)
    const bIdx = KNOWN_GROUP_ORDER.indexOf(b)
    const aRank = aIdx >= 0 ? aIdx : 100
    const bRank = bIdx >= 0 ? bIdx : 100
    return aRank - bRank || a.localeCompare(b)
  })

  const toItem = (item: AppNavContribution): ShellSidebarItem => {
    const targetPage = options.pages.find(
      (candidate) => candidate.pluginId === item.pluginId && candidate.id === item.page
    )
    const rawHref = pluginPageHref(item.pluginId, item.page, item.params)
    const active = options.activePage
      ? options.activePage.pluginId === item.pluginId &&
        (options.activePage.id === item.page ||
          options.appNav.filter((cand) => cand.pluginId === item.pluginId).length === 1)
      : false

    return {
      id: `${item.pluginId}:${item.id}`,
      pluginId: item.pluginId,
      pageId: item.page,
      title: resolveContributionText({
        dictionary: targetPage?.dictionary,
        key: item.titleKey,
        literal: item.title ?? targetPage?.title ?? item.id,
        locale: options.locale,
        pluginId: item.pluginId,
        i18n: options.i18n,
      }),
      href: options.formatHref(rawHref),
      icon: item.icon,
      isActive: active,
      onNavigate: () => options.pushTarget(item.pluginId, item.page, item.params),
    }
  }

  const mainGroups: ShellSidebarGroup[] = []
  let accountItems: ShellSidebarItem[] = []

  for (const groupKey of sortedKeys) {
    const rawItems = grouped.get(groupKey) ?? []
    const mapped = rawItems.map(toItem)
    if (groupKey === "account") {
      accountItems = mapped
    } else if (mapped.length > 0) {
      mainGroups.push({
        group: groupKey,
        label: options.groupLabel(groupKey),
        items: mapped,
      })
    }
  }

  return { mainGroups, accountItems }
}

export function buildMobileBottomTabs(options: {
  readonly navigation: Pick<PluginNavigationService, "forScope">
  readonly pages: readonly PluginPageContribution[]
  readonly activePage: PluginPageContribution | undefined
  readonly locationParams: RouteParams
  readonly locale: PluginLocale
  readonly i18n: Pick<PluginI18nService, "translate">
  readonly formatHref: (rawHref: string) => string
  readonly replaceTarget: (
    pluginId: string,
    pageId: string,
    params?: Readonly<Record<string, string | number>>
  ) => void
}): {
  readonly scope: PluginNavigationScope
  readonly tabs: readonly ShellMobileTab[]
} {
  const activePluginId = options.activePage?.pluginId
  const activePageId = options.activePage?.id

  const scopedItems = activePluginId ? options.navigation.forScope("plugin", activePluginId) : []

  if (scopedItems.length > 0 && activePluginId && activePageId) {
    const activeNavId = resolveActiveScopedNavId(
      scopedItems,
      options.pages,
      activePluginId,
      activePageId,
      options.locationParams
    )
    const tabs: ShellMobileTab[] = scopedItems.map((item) => {
      const targetPage = options.pages.find(
        (candidate) => candidate.pluginId === item.pluginId && candidate.id === item.page
      )
      const rawHref = pluginPageHref(item.pluginId, item.page, item.params)
      return {
        id: item.id,
        pluginId: item.pluginId,
        href: options.formatHref(rawHref),
        label: resolveContributionText({
          dictionary: targetPage?.dictionary,
          key: item.titleKey,
          literal: item.title ?? targetPage?.title ?? item.id,
          locale: options.locale,
          pluginId: item.pluginId,
          i18n: options.i18n,
        }),
        icon: item.icon,
        ...(item.badge !== undefined ? { badge: item.badge } : {}),
        isActive: item.id === activeNavId,
        onNavigate: () => options.replaceTarget(item.pluginId, item.page, item.params),
      }
    })
    return { scope: "plugin", tabs }
  }

  const appPrimary = options.navigation
    .forScope<AppNavContribution>("app")
    .filter((item) => item.primary === true)

  const tabs: ShellMobileTab[] = appPrimary.map((item) => {
    const targetPage = options.pages.find(
      (candidate) => candidate.pluginId === item.pluginId && candidate.id === item.page
    )
    const rawHref = pluginPageHref(item.pluginId, item.page, item.params)
    const isActive = options.activePage ? options.activePage.pluginId === item.pluginId : false
    return {
      id: item.id,
      pluginId: item.pluginId,
      href: options.formatHref(rawHref),
      label: resolveContributionText({
        dictionary: targetPage?.dictionary,
        key: item.titleKey,
        literal: item.title ?? targetPage?.title ?? item.id,
        locale: options.locale,
        pluginId: item.pluginId,
        i18n: options.i18n,
      }),
      icon: item.icon,
      ...(item.badge !== undefined ? { badge: item.badge } : {}),
      isActive,
      onNavigate: () => options.replaceTarget(item.pluginId, item.page, item.params),
    }
  })

  return { scope: "app", tabs }
}
