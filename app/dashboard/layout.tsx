"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { useAuthStore } from "@/lib/stores/auth"
import { useMobileHeaderStore } from "@/lib/stores/mobile-header"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/lib/stores/settings"
import { useTranslation } from "@/lib/i18n/use-translation"
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
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service"
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit"
import {
  CircleOff,
  GraduationCap,
  Info,
  LogIn,
  LogOut,
  Settings,
  TriangleAlert,
  User,
} from "lucide-react"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { MobileTopBar } from "@/components/mobile-top-bar"
import { RefreshIndicator } from "@/components/refresh-indicator"
import { StaleIndicator } from "@/components/stale-indicator"
import { EXTRA_FEATURES } from "@/lib/extras/registry"
import { FEE_FEATURES } from "@/lib/fees/registry"
import {
  ACADEMIC_FEATURES,
  ACADEMIC_NAV_GROUPS,
  blockedCapabilityForPath,
} from "@/lib/dashboard-nav"
import { isDashboardFeatureAvailable } from "@/lib/dashboard-features"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { useProviderCapabilities } from "@/providers/use-provider"
import { UpdateDialog } from "@/components/update-dialog"
import { APP_VERSION, APP_BUILD } from "@/lib/version"
import { useStoredMediaUrl } from "@/lib/storage/media"
import { loadAvatarImage } from "@/lib/storage/avatar"

const SIDEBAR_WIDTH_KEY = "dashboard-sidebar-width"
const DEFAULT_SIDEBAR_WIDTH = 288 // 18rem
const MIN_SIDEBAR_WIDTH = 208 // 13rem
const MAX_SIDEBAR_WIDTH = 384 // 24rem

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

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const { isAuthenticated, hasHydrated, username, sessionExpired } = useAuthStore()
  const { t } = useTranslation()
  const fullscreenRequested = useMobileHeaderStore((s) => s.fullscreen)
  const mobileFullscreen = pathname === "/dashboard/schedule" && fullscreenRequested

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
  const navGroups = [
    ...ACADEMIC_NAV_GROUPS.map((group) => ({
      label: t(group.labelKey),
      items: group.features
        .filter((f) => isDashboardFeatureAvailable(f, capabilities))
        .map((f) => ({ title: t(f.nav.titleKey), url: f.nav.url, icon: f.nav.icon })),
    })),
    {
      label: t("fees.nav"),
      items: FEE_FEATURES.filter((f) => isDashboardFeatureAvailable(f, capabilities)).map((f) => ({
        title: t(f.nav.titleKey),
        url: f.nav.url,
        icon: f.nav.icon,
      })),
    },
    // 玩具箱：与教务无关的第三方功能（lib/extras/registry.ts）
    {
      label: t("extras.nav"),
      items: EXTRA_FEATURES.map((f) => ({
        title: t(f.nav.titleKey),
        url: f.nav.url,
        icon: f.nav.icon,
      })),
    },
  ].filter((group) => group.items.length > 0)

  const titleByPath: Record<string, string> = {
    ...Object.fromEntries(
      [...ACADEMIC_FEATURES, ...FEE_FEATURES, ...EXTRA_FEATURES].flatMap((f) =>
        Object.entries(f.titleKeys).map(([path, key]) => [path, t(key)])
      )
    ),
    "/dashboard/me": t("app.me"),
    "/dashboard/me/student": t("app.studentInfo"),
    "/dashboard/me/background": t("app.backgroundSettings"),
    "/dashboard/me/settings": t("settings.title"),
    "/dashboard/me/settings/overview": t("overviewLayout.customize"),
    "/dashboard/me/avatar": t("app.avatarSettings"),
    "/dashboard/me/about": t("about.title"),
  }
  const pageTitle = titleByPath[pathname] ?? t("app.name")

  const primaryPaths = new Set([
    "/dashboard",
    "/dashboard/schedule",
    "/dashboard/grades",
    "/dashboard/me",
  ])
  const showBack = !primaryPaths.has(pathname)
  const blockedCapability = blockedCapabilityForPath(pathname, capabilities)

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
        <div
          className="hud-label flex items-center gap-2 border-2 border-edge bg-card px-4 py-2 shadow-xs"
          suppressHydrationWarning
        >
          <span className="size-1.5 animate-pulse bg-brand" />
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
          <div className="flex items-center gap-2.5 border-b-2 border-edge/25 px-2 py-3 transition-all duration-200 ease-linear group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <span className="flex size-8 shrink-0 items-center justify-center border-2 border-edge bg-brand text-brand-foreground">
              <GraduationCap className="size-4.5" strokeWidth={2.4} />
            </span>
            <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate font-heading text-sm leading-tight font-bold tracking-tight">
                {t("app.name")}
              </span>
              <span className="hud-label leading-tight">RHODES TERMINAL</span>
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label} className="py-1.5">
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.url}
                        tooltip={item.title}
                        className="py-2 [&_svg]:transition-transform [&_svg]:duration-150 hover:[&_svg]:scale-105 data-[active=true]:[&_svg]:scale-105"
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
          <SidebarGroup className="mt-auto py-1.5">
            <SidebarSeparator />
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === "/dashboard/me" || pathname.startsWith("/dashboard/me/")}
                    tooltip={t("app.me")}
                    className="py-2 [&_svg]:transition-transform [&_svg]:duration-150 hover:[&_svg]:scale-105 data-[active=true]:[&_svg]:scale-105"
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
            className="flex items-center gap-2 rounded-none px-2 py-1.5 font-mono text-[0.65rem] tracking-wide text-muted-foreground transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
        <header className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b-2 border-edge bg-background/95 px-6 py-3 backdrop-blur md:flex">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger aria-label={t("app.toggleSidebar")} title={t("app.toggleSidebar")} />
            <span aria-hidden="true" className="h-5 w-px bg-edge/30" />
            <div className="flex min-w-0 flex-col">
              <span className="hud-label leading-none">YSU // TERMINAL</span>
              <h1 className="animate-in truncate font-heading text-lg leading-tight font-semibold tracking-tight duration-300 fade-in slide-in-from-left-2">
                {pageTitle}
              </h1>
            </div>
            <RefreshIndicator />
            <StaleIndicator />
          </div>
          <div className="flex items-center gap-3">
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
                <Button variant="ghost" size="icon" className="relative">
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
        <div
          key={pathname}
          className={cn(
            "flex flex-1 flex-col md:p-6 lg:p-8",
            mobileFullscreen
              ? "min-h-0 overflow-hidden"
              : "animate-in p-4 duration-500 fade-in slide-in-from-bottom-2"
          )}
        >
          {blockedCapability ? (
            <Empty className="flex-1 justify-center">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleOff />
                </EmptyMedia>
                <EmptyTitle>{t("app.featureUnavailable")}</EmptyTitle>
                <EmptyDescription>{t("app.featureUnavailableDesc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            children
          )}
        </div>
      </main>
      {!mobileFullscreen && <MobileBottomNav />}
    </SidebarProvider>
  )
}
