"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useSettingsStore } from "@/lib/stores/settings"
import { useProviderCapabilities, useSupportedPlugins } from "@/providers/use-provider"
import { usePluginHost } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { pluginPageHref, supportsPlugin } from "@orahako/plugin-sdk"
import { usePluginRouteStore } from "@/lib/stores/plugin-route"
import { hasPluginCapability } from "@/lib/plugins/navigation"

export function MobileBottomNav() {
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const { t, locale } = useTranslation()
  const { host } = usePluginHost()
  const { navigation } = usePluginUI(host.ui)
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
  const tabs = [
    ...navigation
      .filter((item) => item.primary)
      .map((item) => ({
        href: pluginPageHref(item.pluginId, item.page),
        label: item.titleKey
          ? host.i18n.translate(item.pluginId, item.titleKey, locale)
          : item.title,
        icon: item.icon,
        capability: item.capability,
        pluginId: item.pluginId,
      })),
    { href: "/dashboard/me", label: t("app.me"), icon: User },
  ].filter((tab) => {
    if (!hasPluginCapability(capabilities, "capability" in tab ? tab.capability : undefined)) {
      return false
    }
    return !("pluginId" in tab) || supportsPlugin(supportedPlugins, tab.pluginId)
  })

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
          "pluginId" in tab && tab.pluginId
            ? pluginRoute?.pluginId === tab.pluginId
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon className="size-5" />
            <span>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
