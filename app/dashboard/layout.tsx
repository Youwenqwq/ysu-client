"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore } from "@/lib/settings-store";
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
import { resetSDK } from "@/lib/sdk";
import { checkRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import {
  BookOpen,
  Calendar,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Info,
  LayoutDashboard,
  LogIn,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { RefreshIndicator } from "@/components/refresh-indicator";
import { StaleIndicator } from "@/components/stale-indicator";
import { UpdateDialog } from "@/components/update-dialog";
import { APP_VERSION, APP_BUILD } from "@/lib/version";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const rawPathname = usePathname();
  const pathname = rawPathname.replace(/\/$/, "");
  const { isAuthenticated, hasHydrated, username, clearCredential } = useAuthStore();
  const { t, locale, setLocale } = useTranslation();

  const credential = useAuthStore((s) => s.credential);
  const backgroundImage = useSettingsStore((s) => s.backgroundImage);
  const avatarImage = useSettingsStore((s) => s.avatarImage);
  const hasBackground = !!backgroundImage;

  const navItems = [
    { title: t("app.overview"), url: "/dashboard", icon: LayoutDashboard },
    { title: t("app.grades"), url: "/dashboard/grades", icon: GraduationCap },
    { title: t("app.schedule"), url: "/dashboard/schedule", icon: Calendar },
    { title: t("app.exams"), url: "/dashboard/exams", icon: FileText },
    { title: t("app.trainingPlan"), url: "/dashboard/training-plan", icon: BookOpen },
    { title: t("app.evaluation"), url: "/dashboard/evaluation", icon: ClipboardCheck },
  ];

  const titleByPath: Record<string, string> = {
    "/dashboard": t("app.overview"),
    "/dashboard/grades": t("app.grades"),
    "/dashboard/gpa": t("app.gpa"),
    "/dashboard/schedule": t("app.schedule"),
    "/dashboard/exams": t("app.exams"),
    "/dashboard/training-plan": t("app.trainingPlan"),
    "/dashboard/evaluation": t("app.evaluation"),
    "/dashboard/me": t("app.me"),
    "/dashboard/me/student": t("app.studentInfo"),
    "/dashboard/me/gpa": t("app.gpa"),
    "/dashboard/me/background": t("app.backgroundSettings"),
    "/dashboard/me/settings": t("settings.title"),
    "/dashboard/me/avatar": t("app.avatarSettings"),
    "/dashboard/me/about": t("about.title"),
  };
  const pageTitle = titleByPath[pathname] ?? t("app.name");

  const primaryPaths = new Set(["/dashboard", "/dashboard/schedule", "/dashboard/grades", "/dashboard/evaluation", "/dashboard/me"]);
  const showBack = !primaryPaths.has(pathname);

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace("/login");
    }
  }, [hasHydrated, isAuthenticated, router]);

  function handleLogout() {
    clearCredential();
    resetSDK();
    toast.success(t("app.logout"));
    router.replace("/login");
  }

  async function handleRelogin() {
    const limit = checkRateLimit();
    if (!limit.allowed) {
      const totalSeconds = Math.ceil(limit.retryAfterMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const message =
        limit.reason === "window"
          ? t("autoLogin.errorRateLimitWindow")
              .replace("{minutes}", String(minutes))
              .replace("{seconds}", seconds.toString().padStart(2, "0"))
          : t("autoLogin.errorRateLimitInterval").replace("{seconds}", String(seconds));
      toast.error(message);
      return;
    }
    recordLoginAttempt();

    try {
      const { tryAutoLogin } = await import("@/lib/auto-login");
      const success = await tryAutoLogin();
      if (success) {
        toast.success(t("login.loginSuccess"));
        return;
      }
    } catch {
      // fall through
    }
    clearCredential();
    resetSDK();
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
          <SidebarGroup>
            <SidebarGroupLabel>{t("app.nav")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {navItems.map((item) => (
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
      <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden pt-[calc(3rem+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] pb-[calc(4rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] md:overflow-auto md:pb-[env(safe-area-inset-bottom)] md:pt-[env(safe-area-inset-top)]">
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
                    {avatarImage && <AvatarImage src={avatarImage} alt="avatar" />}
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
