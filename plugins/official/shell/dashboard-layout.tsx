"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuthStore } from "@orahako/plugin-ui/stores"
import { useMobileHeaderStore } from "@orahako/plugin-ui/stores"
import { cn } from "@orahako/plugin-ui/components"
import { useSettingsStore } from "@orahako/plugin-ui/stores"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import { Alert, AlertTitle } from "@orahako/plugin-ui/components"
import { Avatar, AvatarFallback, AvatarImage } from "@orahako/plugin-ui/components"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@orahako/plugin-ui/components"
import { toast } from "sonner"
import { logoutActiveProvider, reloginActiveProvider } from "@orahako/plugin-ui/stores"
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@orahako/plugin-ui/platform"
import { GraduationCap, Info, LogIn, LogOut, Settings, TriangleAlert, User } from "lucide-react"
import { MobileBottomNav, MobileTopBar } from "@orahako/plugin-ui/shell"
import { RefreshIndicator, StaleIndicator } from "@orahako/plugin-ui/shell"
import { useProviderCapabilities, useSupportedPlugins } from "@orahako/plugin-ui/hooks"
import { UpdateDialog } from "@orahako/plugin-ui/shell"
import { APP_VERSION, APP_BUILD } from "@orahako/plugin-ui/platform"
import { useStoredMediaUrl } from "@orahako/plugin-ui/hooks"
import { loadAvatarImage } from "@orahako/plugin-ui/stores"
import { usePluginHost } from "@orahako/plugin-ui/shell"
import { usePluginUI } from "@orahako/plugin-ui/plugin"
import { PluginSlot, pluginPageHref, supportsPlugin, type PluginIcon } from "@orahako/plugin-sdk"
import { usePluginRouteStore } from "@orahako/plugin-ui/plugin"
import { hasPluginCapability } from "@orahako/plugin-ui/plugin"
const SIDEBAR_WIDTH_KEY = "dashboard-sidebar-width"
const DEFAULT_SIDEBAR_WIDTH = 288 // 18rem
const MIN_SIDEBAR_WIDTH = 208 // 13rem
const MAX_SIDEBAR_WIDTH = 384 // 24rem

interface DashboardNavItem {
  title: string
  url: string
  icon: PluginIcon
  pluginId?: string
}

interface DashboardNavGroup {
  label: string
  items: DashboardNavItem[]
}

function SidebarResizeHandle() {
  const { state, setOpen, isMobile } = useSidebar()

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // 折叠态（图标栏）下拖拽先展开，再继续调宽
      const needExpand = state === "collapsed"
      if (needExpand) setOpen(true)

      const handle = event.currentTarget
      const wrapper = handle.closest<HTMLElement>("[data-slot=sidebar-wrapper]")
      const gap = wrapper?.querySelector<HTMLElement>("[data-slot=sidebar-gap]")
      const container = wrapper?.querySelector<HTMLElement>("[data-slot=sidebar-container]")
      if (!wrapper) return

      const startX = event.clientX
      const startWidth = needExpand
        ? DEFAULT_SIDEBAR_WIDTH
        : (gap?.getBoundingClientRect().width ?? DEFAULT_SIDEBAR_WIDTH)

      // 拖拽期间禁用宽度过渡，避免拖动延迟
      gap?.classList.add("transition-none!")
      container?.classList.add("transition-none!")
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      const onPointerMove = (e: PointerEvent) => {
        const width = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, Math.round(startWidth + e.clientX - startX))
        )
        wrapper.style.setProperty("--sidebar-width", `${width}px`)
      }

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove)
        document.removeEventListener("pointerup", onPointerUp)
        document.removeEventListener("pointercancel", onPointerUp)
        gap?.classList.remove("transition-none!")
        container?.classList.remove("transition-none!")
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        const finalWidth = gap?.getBoundingClientRect().width ?? startWidth
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(finalWidth)))
        } catch {
          // localStorage unavailable
        }
      }

      document.addEventListener("pointermove", onPointerMove)
      document.addEventListener("pointerup", onPointerUp)
      document.addEventListener("pointercancel", onPointerUp)
    },
    [state, setOpen]
  )

  if (isMobile) return null

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onPointerDown={handlePointerDown}
      onDoubleClick={() => setOpen(false)}
      className="absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-col-resize touch-none justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-sidebar-border md:flex"
    />
  )
}

function RouteTransition({
  fullscreen,
  children,
}: {
  fullscreen: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname().replace(/\/$/, "")
  const searchParams = useSearchParams()
  const pluginId = searchParams.get("plugin")
  const pageId = searchParams.get("page") ?? "index"
  // Recreate the animated container when the displayed page identity changes.
  // Plugin pages share one pathname, so pathname alone cannot detect tab switches.
  const routeKey = pluginId ? `${pathname}?${pluginId}:${pageId}` : pathname

  return (
    <div
      key={routeKey}
      className={cn(
        "flex flex-1 flex-col md:p-8",
        fullscreen
          ? "min-h-0 overflow-hidden"
          : "animate-in p-4 duration-500 fade-in slide-in-from-bottom-2"
      )}
    >
      {children}
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const { isAuthenticated, hasHydrated, username, sessionExpired } = useAuthStore()
  const { t, locale } = useTranslation()
  const fullscreenRequested = useMobileHeaderStore((s) => s.fullscreen)
  const pluginRoute = usePluginRouteStore((state) => state.current)
  const mobileFullscreen = Boolean(pluginRoute?.fullscreen && fullscreenRequested)

  const backgroundImage = useSettingsStore((s) => s.backgroundImage)
  const avatarImage = useSettingsStore((s) => s.avatarImage)
  const hasBackground = !!backgroundImage
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage)

  // 侧边栏宽度：挂载后从 localStorage 恢复（此前已由 hasHydrated 门控，不会闪烁）
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [reloginLoading, setReloginLoading] = useState(false)
  // 折叠状态：sidebar.tsx 会写入 sidebar_state cookie，这里在挂载时恢复
  const [defaultSidebarOpen] = useState(
    () => !document.cookie.split("; ").includes("sidebar_state=false")
  )
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
      if (Number.isFinite(stored) && stored > 0) {
        setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored)))
      }
    } catch {
      // localStorage unavailable
    }
  }, [])

  // Ctrl/Cmd+B 折叠/展开侧边栏
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        if (!window.matchMedia("(min-width: 768px)").matches) return
        e.preventDefault()
        document.querySelector<HTMLElement>("[data-sidebar=trigger]")?.click()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const capabilities = useProviderCapabilities()
  const supportedPlugins = useSupportedPlugins()
  const { host } = usePluginHost()
  const { navigation: pluginNavigation } = usePluginUI(host.ui)
  const availableNavigation = pluginNavigation.filter(
    (item) =>
      supportsPlugin(supportedPlugins, item.pluginId) &&
      hasPluginCapability(capabilities, item.capability)
  )
  const knownGroupOrder = ["main", "academic", "platform", "fees", "extras", "plugins"]
  const groupLabels: Record<string, string> = {
    main: t("app.nav"),
    academic: t("me.sectionAcademic"),
    platform: t("me.sectionPlatforms"),
    fees: t("fees.nav"),
    extras: t("extras.nav"),
    plugins: t("plugins.title"),
  }
  const groupIds = Array.from(new Set(availableNavigation.map((item) => item.group))).sort(
    (a, b) => {
      const aOrder = knownGroupOrder.includes(a) ? knownGroupOrder.indexOf(a) : 100
      const bOrder = knownGroupOrder.includes(b) ? knownGroupOrder.indexOf(b) : 100
      return aOrder - bOrder || a.localeCompare(b)
    }
  )
  const visibleNavGroups: DashboardNavGroup[] = groupIds.map((group) => ({
    label: groupLabels[group] ?? group,
    items: availableNavigation
      .filter((item) => item.group === group)
      .map((item) => ({
        title: item.titleKey
          ? host.i18n.translate(item.pluginId, item.titleKey, locale)
          : item.title,
        url: pluginPageHref(item.pluginId, item.page),
        icon: item.icon,
        pluginId: item.pluginId,
      })),
  }))

  const titleByPath: Record<string, string> = {
    "/dashboard/me": t("app.me"),
    "/dashboard/me/background": t("app.backgroundSettings"),
    "/dashboard/me/settings": t("settings.title"),
    "/dashboard/me/plugins": t("plugins.title"),
    "/dashboard/me/settings/overview": t("overviewLayout.customize"),
    "/dashboard/me/settings/widgets": t("desktopWidgets.title"),
    "/dashboard/me/avatar": t("app.avatarSettings"),
    "/dashboard/me/about": t("about.title"),
  }
  const pageTitle = pluginRoute
    ? pluginRoute.titleKey
      ? host.i18n.translate(pluginRoute.pluginId, pluginRoute.titleKey, locale)
      : pluginRoute.title
    : (titleByPath[pathname] ?? t("app.name"))

  const showBack = pluginRoute ? !pluginRoute.primary : pathname !== "/dashboard/me"

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace("/login")
    }
  }, [hasHydrated, isAuthenticated, router])

  async function handleLogout() {
    await logoutActiveProvider()
    toast.success(t("app.logout"))
    router.replace("/login")
  }

  async function handleRelogin() {
    if (reloginLoading) return

    const limit = checkRateLimit()
    if (!limit.allowed) {
      toast.error(
        rateLimitMessage(
          limit,
          t,
          "autoLogin.errorRateLimitWindow",
          "autoLogin.errorRateLimitInterval"
        )
      )
      return
    }
    recordLoginAttempt()
    setReloginLoading(true)

    try {
      const success = await reloginActiveProvider()
      if (success) {
        toast.success(t("login.loginSuccess"))
        return
      }
    } catch {
      // fall through
    } finally {
      setReloginLoading(false)
    }
    await logoutActiveProvider()
    router.replace("/login")
  }

  if (!hasHydrated) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground" suppressHydrationWarning>
          {t("app.updating")}
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <UpdateDialog />
      <Sidebar
        collapsible="icon"
        className={
          "[&_[data-sidebar=menu-button]]:py-3 " +
          (hasBackground
            ? "[&_[data-slot=sidebar-inner]]:bg-sidebar/70 [&_[data-slot=sidebar-inner]]:backdrop-blur-md"
            : "")
        }
      >
        <SidebarResizeHandle />
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3 transition-all duration-200 ease-linear group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <GraduationCap className="size-6 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            <span className="font-semibold group-data-[collapsible=icon]:hidden">
              {t("app.name")}
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          {visibleNavGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          pluginRoute && "pluginId" in item
                            ? pluginRoute.pluginId === item.pluginId
                            : pathname === item.url
                        }
                        tooltip={item.title}
                        className="py-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:translate-x-1 active:scale-[0.98] data-[active=true]:shadow-sm [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:scale-110 data-[active=true]:[&_svg]:scale-110"
                      >
                        <Link href={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
          <SidebarGroup className="mt-auto">
            <SidebarSeparator />
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/dashboard/me" || pathname.startsWith("/dashboard/me/")}
                    tooltip={t("app.me")}
                    className="py-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:translate-x-1 active:scale-[0.98] data-[active=true]:shadow-sm [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:scale-110 data-[active=true]:[&_svg]:scale-110"
                  >
                    <Link href="/dashboard/me">
                      <User />
                      <span>{t("app.me")}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <button
            onClick={() => router.push("/dashboard/me/about")}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Info className="size-3.5 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">
              v{APP_VERSION} ({APP_BUILD})
            </span>
          </button>
        </SidebarFooter>
      </Sidebar>
      <main
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-x-hidden pt-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] md:overflow-auto md:pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] md:pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))]",
          mobileFullscreen
            ? "h-dvh min-h-0 overflow-hidden pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] md:h-auto"
            : "pb-[var(--mobile-bottom-nav-height,calc(4rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))))]"
        )}
      >
        <MobileTopBar title={pageTitle} showBack={showBack} />
        {sessionExpired && (
          <Alert variant="destructive" className="mx-4 mt-4 w-auto md:mx-6 md:mt-6">
            <TriangleAlert />
            <AlertTitle className="flex flex-wrap items-center gap-3">
              <span>{t("app.sessionExpired")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRelogin}
                disabled={reloginLoading}
                aria-busy={reloginLoading}
              >
                {reloginLoading ? t("app.updating") : t("app.relogin")}
              </Button>
            </AlertTitle>
          </Alert>
        )}
        <header className="hidden items-center justify-between gap-4 border-b px-6 py-4 md:flex">
          <div className="flex items-center gap-3">
            <SidebarTrigger aria-label={t("app.toggleSidebar")} title={t("app.toggleSidebar")} />
            <h1 className="animate-in text-lg font-semibold duration-300 fade-in slide-in-from-left-2">
              {pageTitle}
            </h1>
            <RefreshIndicator />
            <StaleIndicator />
          </div>
          <div className="flex items-center gap-3">
            <PluginSlot name="dashboard.header.actions" />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => router.push("/dashboard/me/settings")}
              aria-label={t("app.settings")}
            >
              <Settings className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative size-8 rounded-full">
                  <Avatar className="size-8">
                    {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
                    <AvatarFallback className="text-xs">
                      {username?.slice(-2) || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem disabled className="flex flex-col items-start gap-0.5">
                  <span className="font-medium text-foreground">{username || t("app.login")}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleRelogin}>
                  <LogIn />
                  {t("app.relogin")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut />
                  {t("app.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <Suspense fallback={null}>
          <RouteTransition fullscreen={mobileFullscreen}>{children}</RouteTransition>
        </Suspense>
      </main>
      {!mobileFullscreen && <MobileBottomNav />}
    </SidebarProvider>
  )
}
