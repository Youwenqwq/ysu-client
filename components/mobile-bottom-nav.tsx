"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Calendar, GraduationCap, LayoutDashboard, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useSettingsStore } from "@/lib/stores/settings"
import { useProviderCapabilities } from "@/providers/use-provider"
import { hasCapability } from "@/providers/capabilities"
import type { AcademicCapabilities } from "@/providers/types"

export function MobileBottomNav() {
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const { t } = useTranslation()
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
  const tabs = [
    { href: "/dashboard", label: t("app.overview"), icon: LayoutDashboard },
    {
      href: "/dashboard/schedule",
      label: t("app.schedule"),
      icon: Calendar,
      capability: "schedule",
    },
    {
      href: "/dashboard/grades",
      label: t("app.grades"),
      icon: GraduationCap,
      capability: "grades",
    },
    { href: "/dashboard/me", label: t("app.me"), icon: User },
  ].filter(
    (tab) =>
      !("capability" in tab) ||
      hasCapability(capabilities, tab.capability as keyof AcademicCapabilities)
  )

  return (
    <nav
      ref={navRef}
      className={cn(
        "native-safe-horizontal fixed inset-x-0 bottom-0 z-40 grid border-t border-border pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] backdrop-blur md:hidden",
        hasBackground
          ? "bg-background/60 supports-[backdrop-filter]:bg-background/40"
          : "bg-background/95 supports-[backdrop-filter]:bg-background/80"
      )}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      aria-label="Primary"
    >
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/dashboard"
            ? pathname === "/dashboard"
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
