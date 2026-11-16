"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { User } from "lucide-react"
import { cn } from "@orahako/plugin-ui/components"
import { useTranslation } from "@/plugins/official/runtime/i18n/use-translation"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import { useProviderCapabilities, useSupportedPlugins } from "@orahako/plugin-ui/hooks"
import { usePluginServices, usePluginUI } from "@orahako/plugin-ui/plugin"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { pluginPageHref } from "@orahako/plugin-sdk"
import { usePluginRouteStore } from "@/plugins/official/shell/stores/plugin-route"
import { resolveActivePluginNavigation, resolveMobileNavigation } from "@/plugins/official/runtime/navigation/resolvers"

export function MobileBottomNav() {
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const searchParams = useSearchParams()
  const { t } = useTranslation()
  const { translate } = usePluginTranslation("")
  const services = usePluginServices()
  const { pages, navigation } = usePluginUI()
  const pluginRoute = usePluginRouteStore((state) => state.current)
  const hasBackground = useSettingsStore((s) => !!s.backgroundImage)
  const navRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const root = document.documentElement
    // Share the actual border-box height, including labels and the native safe area.
    const updateHeight = () => {
      const height = nav.getBoundingClientRect().height
      if (height > 0) root.style.setProperty("--mobile-bottom-nav-height", `${height}px`)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(nav, { box: "border-box" })
    return () => {
      observer.disconnect()
      root.style.removeProperty("--mobile-bottom-nav-height")
    }
  }, [])

  const capabilities = useProviderCapabilities()
  const supportedPlugins = useSupportedPlugins()
  const isPluginPage = pathname === "/dashboard/plugin"
  const activePluginId = isPluginPage
    ? (searchParams.get("plugin") ?? pluginRoute?.pluginId)
    : undefined
  const activePageId = isPluginPage
    ? (searchParams.get("page") ?? pluginRoute?.pageId ?? "index")
    : undefined
  const selected = resolveMobileNavigation(navigation, activePluginId, {
    capabilities,
    supportedPlugins,
  })
  const activePluginNavigation =
    selected.scope === "plugin" && activePluginId && activePageId
      ? resolveActivePluginNavigation(selected.items, pages, {
          pluginId: activePluginId,
          pageId: activePageId,
          params: searchParams,
        })
      : undefined
  const fallbackHref = services.navigation.sources().fallbackHref
  const tabs = [
    ...selected.items.map((item) => ({
      id: item.id,
      href: pluginPageHref(item.pluginId, item.page, item.params),
      label: item.titleKey ? translate(item.pluginId, item.titleKey) : item.title,
      icon: item.icon,
      badge: item.badge,
      pluginId: item.pluginId,
    })),
    ...(selected.scope === "app" && fallbackHref
      ? [{ id: "me", href: fallbackHref, label: t("app.me"), icon: User }]
      : []),
  ]

  return (
    <nav
      ref={navRef}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid border-t border-border pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] backdrop-blur md:hidden",
        hasBackground
          ? "bg-background/60 supports-[backdrop-filter]:bg-background/40"
          : "bg-background/95 supports-[backdrop-filter]:bg-background/80"
      )}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const isActive =
          selected.scope === "plugin"
            ? tab.id === activePluginNavigation
            : "pluginId" in tab && tab.pluginId
              ? activePluginId === tab.pluginId
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        const Icon = tab.icon
        const Badge = "badge" in tab ? tab.badge : undefined
        return (
          <Link
            key={tab.href}
            href={tab.href}
            replace
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="relative">
              <Icon className="size-5" />
              {Badge ? <Badge /> : null}
            </span>
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
