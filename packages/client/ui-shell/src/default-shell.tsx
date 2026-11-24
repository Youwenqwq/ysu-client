import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { ArrowLeft, GraduationCap, Moon, Settings, Sun } from "lucide-react"
import {
  BackLayerProvider,
  Button,
  cn,
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
  Toaster,
  TooltipProvider,
  useSidebar,
  type CSSCustomProperties,
  type RegisterBackLayer,
} from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginLocale,
  PluginHostPreferenceSnapshot,
  PluginPageContribution,
  PluginUIServiceSnapshot,
  RouteLocation,
  ShellOwnerProps,
  SlotComponent,
} from "@orahako/sdk"
import "./slots-declare"
import type { ShellDictionary } from "./dictionary"
import type { ShellMobileTab, ShellSidebarGroup, ShellSidebarItem } from "./nav-helpers"
import {
  buildCardStyleCss,
  computeCardBgOpacity,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  type AppearanceStoreInstance,
  type BackgroundStyle,
  type CardStyle,
  type ColorMode,
} from "./store"

export const defaultShellChildren = {
  "shell.gate": { kind: "chain" },
  "shell.banner": { kind: "list" },
  "shell.activity": { kind: "list" },
  "shell.header.actions": { kind: "list" },
  "shell.sidebar.footer": { kind: "list" },
  "shell.overlay": { kind: "list" },
} as const

export interface ResolvedShellChrome {
  readonly activePage: PluginPageContribution | undefined
  readonly pageTitle: string
  readonly showBack: boolean
  readonly fullscreen: boolean
  readonly routeKey: string
  readonly mainGroups: readonly ShellSidebarGroup[]
  readonly accountItems: readonly ShellSidebarItem[]
  readonly mobileTabs: readonly ShellMobileTab[]
}

export interface DefaultShellInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
    readonly navRevision: ObservableSource<number>
    readonly backgroundUrl: ObservableSource<string | null>
    readonly preference: ObservableSource<PluginHostPreferenceSnapshot>
  }
  readonly getAppName: (locale: PluginLocale) => string
  readonly getStartupPreference: () => string
  readonly resolveChrome: (
    location: RouteLocation,
    uiSnapshot: PluginUIServiceSnapshot,
    locale: PluginLocale
  ) => ResolvedShellChrome
  readonly settingsHref: string
  readonly navigateToSettings: () => void
  readonly handleBack: (activePage: PluginPageContribution | undefined) => void
  readonly registerBackHandler: RegisterBackLayer
}

export type DefaultShellProps = DerivedComponentProps<
  ShellOwnerProps,
  ShellDictionary,
  typeof defaultShellChildren,
  AppearanceStoreInstance,
  DefaultShellInject
>

function handleSpaClick(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate()
}

function readInitialSidebarOpen(): boolean {
  if (typeof document === "undefined" || typeof document.cookie !== "string") {
    return true
  }
  return !document.cookie.split("; ").includes("sidebar_state=false")
}

function detectSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function SidebarResizeHandle({
  ariaLabel,
  onCommitWidth,
}: {
  readonly ariaLabel: string
  readonly onCommitWidth: (width: number) => void
}) {
  const { state, setOpen, isMobile } = useSidebar()

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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

      gap?.classList.add("transition-none!")
      container?.classList.add("transition-none!")
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      const onPointerMove = (moveEvent: PointerEvent) => {
        const width = Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, Math.round(startWidth + moveEvent.clientX - startX))
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
        onCommitWidth(finalWidth)
      }

      document.addEventListener("pointermove", onPointerMove)
      document.addEventListener("pointerup", onPointerUp)
      document.addEventListener("pointercancel", onPointerUp)
    },
    [onCommitWidth, setOpen, state]
  )

  if (isMobile) return null

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onPointerDown={handlePointerDown}
      onDoubleClick={() => setOpen(false)}
      className="absolute inset-y-0 -right-2 z-20 hidden w-4 cursor-col-resize touch-none justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors hover:after:bg-sidebar-border md:flex"
    />
  )
}

function BackgroundLayer({
  backgroundUrl,
  hasBackground,
  backgroundStyle,
  overlayOpacity,
  blurAmount,
  cardStyle,
  cardOpacity,
}: {
  readonly backgroundUrl: string | null
  readonly hasBackground: boolean
  readonly backgroundStyle: BackgroundStyle
  readonly overlayOpacity: number
  readonly blurAmount: number
  readonly cardStyle: CardStyle
  readonly cardOpacity: number
}) {
  useEffect(() => {
    if (typeof document === "undefined" || !document.documentElement?.style) return
    const opacityValue = computeCardBgOpacity(hasBackground, cardStyle, cardOpacity)
    document.documentElement.style.setProperty("--card-bg-opacity", opacityValue)
    return () => {
      document.documentElement?.style?.setProperty("--card-bg-opacity", "1")
    }
  }, [hasBackground, cardStyle, cardOpacity])

  if (!backgroundUrl) return null

  const cardCss = buildCardStyleCss(cardStyle, cardOpacity)
  const blurPx = `${blurAmount}px`
  const overlayStyle: CSSProperties =
    backgroundStyle === "blur-overlay"
      ? {
          backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
          backdropFilter: `blur(${blurPx})`,
          WebkitBackdropFilter: `blur(${blurPx})`,
        }
      : {
          backgroundColor: `color-mix(in oklch, var(--background) ${overlayOpacity}%, transparent)`,
        }

  return (
    <>
      <div
        aria-hidden="true"
        data-shell-background=""
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url(${backgroundUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundAttachment: "fixed",
        }}
      >
        <div className="absolute inset-0" style={overlayStyle} />
      </div>
      {cardCss && <style data-shell-card-style={cardStyle}>{cardCss}</style>}
    </>
  )
}

function MobileBottomNav({
  tabs,
  hasBackground,
  ariaLabel,
}: {
  readonly tabs: readonly ShellMobileTab[]
  readonly hasBackground: boolean
  readonly ariaLabel: string
}) {
  const navRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || typeof document === "undefined" || !document.documentElement?.style) return
    const root = document.documentElement
    const updateHeight = () => {
      const height = nav.getBoundingClientRect?.().height ?? 0
      if (height > 0) {
        root.style.setProperty("--mobile-bottom-nav-height", `${height}px`)
      }
    }
    updateHeight()
    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(updateHeight)
      observer.observe(nav, { box: "border-box" })
      return () => {
        observer.disconnect()
        root.style.removeProperty("--mobile-bottom-nav-height")
      }
    }
    return () => {
      root.style.removeProperty("--mobile-bottom-nav-height")
    }
  }, [tabs.length])

  if (tabs.length === 0) return null

  return (
    <nav
      ref={navRef}
      data-shell-bottom-nav=""
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 grid border-t border-border pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] backdrop-blur md:hidden",
        hasBackground
          ? "bg-background/60 supports-[backdrop-filter]:bg-background/40"
          : "bg-background/95 supports-[backdrop-filter]:bg-background/80"
      )}
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      aria-label={ariaLabel}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon
        const BadgeComponent = tab.badge
        return (
          <a
            key={`${tab.pluginId}:${tab.id}`}
            href={tab.href}
            onClick={(event) => handleSpaClick(event, tab.onNavigate)}
            className={cn(
              "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
              tab.isActive ? "text-primary" : "text-muted-foreground"
            )}
            aria-current={tab.isActive ? "page" : undefined}
          >
            <span className="relative">
              <Icon className="size-5" />
              {BadgeComponent ? <BadgeComponent /> : null}
            </span>
            <span>{tab.label}</span>
          </a>
        )
      })}
    </nav>
  )
}

export const DefaultShell: SlotComponent<DefaultShellProps> = (props) => {
  const { t, locale, renderSlot, renderSlotChain, useStore, actions } = props
  const location = props.useLocation()
  const uiSnapshot = props.useUi()
  const navRevision = props.useNavRevision()
  const backgroundUrl = props.useBackgroundUrl()
  const preference = props.usePreference()
  const startupPage = preference.startupPage ?? props.getStartupPreference()

  const colorMode: ColorMode = useStore((s) => s.colorMode)
  const backgroundImage = useStore((s) => s.backgroundImage)
  const backgroundStyle = useStore((s) => s.backgroundStyle)
  const overlayOpacity = useStore((s) => s.backgroundOverlayOpacity)
  const blurAmount = useStore((s) => s.backgroundBlurAmount)
  const cardStyle = useStore((s) => s.cardStyle)
  const cardOpacity = useStore((s) => s.cardOpacity)
  const sidebarWidth = useStore((s) => s.sidebarWidth)

  const [systemDark, setSystemDark] = useState<boolean>(detectSystemPrefersDark)
  const [defaultSidebarOpen] = useState<boolean>(readInitialSidebarOpen)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(mql.matches)
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    }
    return undefined
  }, [])

  const isDark = colorMode === "dark" || (colorMode === "system" && systemDark)

  useEffect(() => {
    if (typeof document === "undefined" || !document.documentElement?.classList) return
    document.documentElement.classList.toggle("dark", isDark)
  }, [isDark])

  // Keyboard shortcut Ctrl/Cmd+B toggles desktop sidebar
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        if (
          typeof window.matchMedia === "function" &&
          !window.matchMedia("(min-width: 768px)").matches
        ) {
          return
        }
        event.preventDefault()
        if (typeof document !== "undefined" && typeof document.querySelector === "function") {
          document.querySelector<HTMLElement>("[data-sidebar=trigger]")?.click()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const chrome = useMemo(() => {
    // Navigation filters and the startup preference live outside uiSnapshot.
    void navRevision
    void startupPage
    return props.resolveChrome(location, uiSnapshot, locale)
  }, [locale, location, navRevision, props, startupPage, uiSnapshot])

  const hasBackground = Boolean(backgroundImage || backgroundUrl)
  const showMobileThemeToggle = Boolean(
    chrome.activePage?.primary &&
    chrome.accountItems.some(
      (item) =>
        item.pluginId === chrome.activePage?.pluginId && item.pageId === chrome.activePage?.id
    )
  )
  const appName = props.getAppName(locale)
  const bannerNode = renderSlot("shell.banner")
  const activityNode = renderSlot("shell.activity")
  const headerActionsNode = renderSlot("shell.header.actions")
  const sidebarFooterNode = renderSlot("shell.sidebar.footer")
  const overlayNode = renderSlot("shell.overlay")

  const sidebarStyle: CSSCustomProperties = {
    "--sidebar-width": `${sidebarWidth}px`,
  }

  const shellBody = (
    <SidebarProvider defaultOpen={defaultSidebarOpen} style={sidebarStyle}>
      <Sidebar
        collapsible="icon"
        className={cn(
          "[&_[data-sidebar=menu-button]]:py-3",
          hasBackground &&
            "[&_[data-slot=sidebar-inner]]:bg-sidebar/70 [&_[data-slot=sidebar-inner]]:backdrop-blur-md"
        )}
      >
        <SidebarResizeHandle
          ariaLabel={t("shell.resizeSidebar")}
          onCommitWidth={actions.setSidebarWidth}
        />
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3 transition-all duration-200 ease-linear group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <GraduationCap className="size-6 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            <span className="font-semibold group-data-[collapsible=icon]:hidden">{appName}</span>
          </div>
        </SidebarHeader>

        <SidebarContent className="gap-0">
          {chrome.mainGroups.map((group) => (
            <SidebarGroup key={group.group}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.isActive}
                          tooltip={item.title}
                          className="py-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:translate-x-1 active:scale-[0.98] data-[active=true]:shadow-sm [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:scale-110 data-[active=true]:[&_svg]:scale-110"
                        >
                          <a
                            href={item.href}
                            onClick={(event) => handleSpaClick(event, item.onNavigate)}
                          >
                            <Icon />
                            <span>{item.title}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}

          {chrome.accountItems.length > 0 && (
            <SidebarGroup className="mt-auto">
              <SidebarSeparator />
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {chrome.accountItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={item.isActive}
                          tooltip={item.title}
                          className="py-3 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:translate-x-1 active:scale-[0.98] data-[active=true]:shadow-sm [&_svg]:transition-transform [&_svg]:duration-300 hover:[&_svg]:scale-110 data-[active=true]:[&_svg]:scale-110"
                        >
                          <a
                            href={item.href}
                            onClick={(event) => handleSpaClick(event, item.onNavigate)}
                          >
                            <Icon />
                            <span>{item.title}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        {sidebarFooterNode !== null && <SidebarFooter>{sidebarFooterNode}</SidebarFooter>}
      </Sidebar>

      <main
        data-shell-main=""
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-x-hidden pt-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] md:overflow-auto md:pt-[var(--safe-area-inset-top,env(safe-area-inset-top))] md:pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))]",
          chrome.fullscreen
            ? "h-dvh min-h-0 overflow-hidden pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))] md:h-auto"
            : "pb-[var(--mobile-bottom-nav-height,calc(4rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px))))]"
        )}
      >
        <div
          className="mx-4 mt-4 flex flex-col gap-3 empty:hidden md:mx-6 md:mt-6"
          data-shell-banners=""
        >
          {bannerNode}
        </div>

        {/* One header tree for both breakpoints: fixed top bar on mobile, in-flow on desktop. */}
        <header
          data-shell-header=""
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex w-full items-center justify-between gap-3 px-4",
            "h-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))]",
            "pt-[var(--safe-area-inset-top,env(safe-area-inset-top,0px))] backdrop-blur",
            "md:relative md:inset-auto md:z-auto md:h-auto md:border-b md:bg-transparent",
            "md:px-6 md:py-4 md:pt-0 md:backdrop-blur-none",
            hasBackground
              ? cn(
                  "bg-background/60 supports-[backdrop-filter]:bg-background/40",
                  "md:supports-[backdrop-filter]:bg-transparent"
                )
              : cn(
                  "bg-background/95 supports-[backdrop-filter]:bg-background/80",
                  "md:supports-[backdrop-filter]:bg-transparent"
                )
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">
            <div className="md:hidden">
              {chrome.showBack && (
                <button
                  type="button"
                  data-shell-back=""
                  onClick={() => props.handleBack(chrome.activePage)}
                  className={cn(
                    "-ml-1 flex size-8 shrink-0 items-center justify-center rounded-full",
                    "text-foreground transition-colors active:bg-muted"
                  )}
                  aria-label={t("shell.back")}
                >
                  <ArrowLeft className="size-5" />
                </button>
              )}
            </div>
            <div className="hidden md:block">
              <SidebarTrigger
                aria-label={t("shell.toggleSidebar")}
                title={t("shell.toggleSidebar")}
              />
            </div>
            <h1
              className={cn(
                "truncate text-base font-semibold",
                "md:animate-in md:text-lg md:duration-300 md:fade-in md:slide-in-from-left-2"
              )}
            >
              {chrome.pageTitle}
            </h1>
            {activityNode}
          </div>
          <div className="flex shrink-0 items-center gap-1 md:gap-2">
            {headerActionsNode}
            <div className={cn("flex items-center", showMobileThemeToggle ? "" : "hidden md:flex")}>
              <Button
                type="button"
                data-shell-theme-toggle=""
                variant="ghost"
                size="icon-sm"
                onClick={() => actions.setColorMode(isDark ? "light" : "dark")}
                aria-label={t("shell.toggleTheme")}
              >
                {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
              </Button>
            </div>
            <div className="hidden items-center md:flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                asChild
                aria-label={t("shell.settings")}
              >
                <a
                  href={props.settingsHref}
                  onClick={(event) => handleSpaClick(event, props.navigateToSettings)}
                >
                  <Settings className="size-4" />
                </a>
              </Button>
            </div>
          </div>
        </header>

        <div
          key={chrome.routeKey}
          data-shell-page-outlet=""
          className={cn(
            "flex flex-1 flex-col md:p-8",
            chrome.fullscreen
              ? "min-h-0 overflow-hidden"
              : "animate-in p-4 duration-500 fade-in slide-in-from-bottom-2"
          )}
        >
          {props.children}
        </div>
      </main>

      {!chrome.fullscreen && (
        <MobileBottomNav
          tabs={chrome.mobileTabs}
          hasBackground={hasBackground}
          ariaLabel={t("shell.primaryNav")}
        />
      )}
    </SidebarProvider>
  )

  return (
    <BackLayerProvider registerBackHandler={props.registerBackHandler}>
      <TooltipProvider>
        <BackgroundLayer
          backgroundUrl={backgroundUrl}
          hasBackground={hasBackground}
          backgroundStyle={backgroundStyle}
          overlayOpacity={overlayOpacity}
          blurAmount={blurAmount}
          cardStyle={cardStyle}
          cardOpacity={cardOpacity}
        />
        {renderSlotChain("shell.gate", shellBody)}
        {overlayNode}
        <Toaster theme={isDark ? "dark" : "light"} />
      </TooltipProvider>
    </BackLayerProvider>
  )
}
