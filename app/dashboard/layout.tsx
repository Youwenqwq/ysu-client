"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/stores/auth";
import { useSettingsStore } from "@/lib/stores/settings";
import { useTranslation } from "@/lib/i18n/use-translation";
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
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service";
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit";
import {
  BookOpen,
  Calendar,
  CalendarDays,
  ClipboardCheck,
  FilePenLine,
  FileText,
  Gauge,
  GraduationCap,
  Hammer,
  Info,
  LayoutDashboard,
  Lightbulb,
  LogIn,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { RefreshIndicator } from "@/components/refresh-indicator";
import { StaleIndicator } from "@/components/stale-indicator";
import { EXTRA_FEATURES } from "@/lib/extras/registry";
import { UpdateDialog } from "@/components/update-dialog";
import { APP_VERSION, APP_BUILD } from "@/lib/version";
import { useStoredMediaUrl } from "@/lib/storage/media";
import { loadAvatarImage } from "@/lib/storage/avatar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const rawPathname = usePathname();
  const pathname = rawPathname.replace(/\/$/, "");
  const { isAuthenticated, hasHydrated, username } = useAuthStore();
  const { t } = useTranslation();

  const backgroundImage = useSettingsStore((s) => s.backgroundImage);
  const avatarImage = useSettingsStore((s) => s.avatarImage);
  const hasBackground = !!backgroundImage;
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage);

  const navGroups = [
    {
      label: t("app.nav"),
      items: [
        { title: t("app.overview"), url: "/dashboard", icon: LayoutDashboard },
        { title: t("app.grades"), url: "/dashboard/grades", icon: GraduationCap },
        { title: t("app.schedule"), url: "/dashboard/schedule", icon: Calendar },
      ],
    },
    {
      label: t("me.sectionAcademic"),
      items: [
        { title: t("app.exams"), url: "/dashboard/exams", icon: FileText },
        { title: t("app.makeupExams"), url: "/dashboard/makeup-exams", icon: FilePenLine },
        { title: t("app.trainingPlan"), url: "/dashboard/training-plan", icon: BookOpen },
        { title: t("app.evaluation"), url: "/dashboard/evaluation", icon: ClipboardCheck },
      ],
    },
    {
      label: t("me.sectionPlatforms"),
      items: [
        { title: t("app.labor"), url: "/dashboard/labor", icon: Hammer },
        { title: t("app.credits"), url: "/dashboard/credits", icon: Lightbulb },
        { title: t("app.comprehensive"), url: "/dashboard/comprehensive", icon: Gauge },
        { title: t("app.schoolSchedule"), url: "/dashboard/school-schedule", icon: CalendarDays },
      ],
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
  ];

  const titleByPath: Record<string, string> = {
    ...Object.fromEntries(
      EXTRA_FEATURES.flatMap((f) => Object.entries(f.titleKeys).map(([path, key]) => [path, t(key)])),
    ),
    "/dashboard": t("app.overview"),
    "/dashboard/grades": t("app.grades"),
    "/dashboard/schedule": t("app.schedule"),
    "/dashboard/exams": t("app.exams"),
    "/dashboard/makeup-exams": t("app.makeupExams"),
    "/dashboard/labor": t("app.labor"),
    "/dashboard/credits": t("app.credits"),
    "/dashboard/comprehensive": t("app.comprehensive"),
    "/dashboard/school-schedule": t("app.schoolSchedule"),
    "/dashboard/training-plan": t("app.trainingPlan"),
    "/dashboard/evaluation": t("app.evaluation"),
    "/dashboard/me": t("app.me"),
    "/dashboard/me/student": t("app.studentInfo"),
    "/dashboard/me/background": t("app.backgroundSettings"),
    "/dashboard/me/settings": t("settings.title"),
    "/dashboard/me/avatar": t("app.avatarSettings"),
    "/dashboard/me/about": t("about.title"),
  };
  const pageTitle = titleByPath[pathname] ?? t("app.name");

  const primaryPaths = new Set(["/dashboard", "/dashboard/schedule", "/dashboard/grades", "/dashboard/me"]);
  const showBack = !primaryPaths.has(pathname);

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace("/login");
    }
  }, [hasHydrated, isAuthenticated, router]);

  async function handleLogout() {
    await logoutActiveProvider();
    toast.success(t("app.logout"));
    router.replace("/login");
  }

  async function handleRelogin() {
    const limit = checkRateLimit();
    if (!limit.allowed) {
      toast.error(
        rateLimitMessage(
          limit,
          t,
          "autoLogin.errorRateLimitWindow",
          "autoLogin.errorRateLimitInterval",
        ),
      );
      return;
    }
    recordLoginAttempt();

    try {
      const success = await reloginActiveProvider();
      if (success) {
        toast.success(t("login.loginSuccess"));
        return;
      }
    } catch {
      // fall through
    }
    await logoutActiveProvider();
    router.replace("/login");
  }

  if (!hasHydrated) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-muted-foreground" suppressHydrationWarning>{t("app.updating")}</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <SidebarProvider style={{ "--sidebar-width": "18rem" } as React.CSSProperties}>
      <UpdateDialog />
      <Sidebar
        className={
          "[&_[data-sidebar=menu-button]]:py-3 " +
          (hasBackground
            ? "[&_[data-slot=sidebar-inner]]:bg-sidebar/70 [&_[data-slot=sidebar-inner]]:backdrop-blur-md"
            : "")
        }
      >
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3">
            <GraduationCap className="size-6 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]" />
            <span className="font-semibold">{t("app.name")}</span>
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          {navGroups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.url}
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
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Info className="size-3.5" />
            <span>v{APP_VERSION} ({APP_BUILD})</span>
          </button>
        </SidebarFooter>
      </Sidebar>
      <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden pt-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-[calc(4rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] md:overflow-auto md:pb-[var(--safe-area-inset-bottom,env(safe-area-inset-bottom))] md:pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]">
        <MobileTopBar title={pageTitle} showBack={showBack} />
        <header className="hidden items-center justify-between gap-4 border-b px-6 py-4 md:flex">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold animate-in fade-in slide-in-from-left-2 duration-300">
              {pageTitle}
            </h1>
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
        <div key={pathname} className="flex flex-1 flex-col p-4 animate-in fade-in slide-in-from-bottom-2 duration-500 md:p-8">
          {children}
        </div>
      </main>
      <MobileBottomNav />

    </SidebarProvider>
  );
}
