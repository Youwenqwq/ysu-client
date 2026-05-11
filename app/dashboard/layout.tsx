"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { getStudentInfo } from "@/lib/api";
import type { StudentInfo } from "@/lib/types";
import {
  BookOpen,
  Calendar,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  User,
  Globe,
} from "lucide-react";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { MobileTopBar } from "@/components/mobile-top-bar";
import { RefreshIndicator } from "@/components/refresh-indicator";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { isAuthenticated, hasHydrated, username, clearCredential } = useAuthStore();
  const { t, locale, setLocale } = useTranslation();

  const [studentInfo, setStudentInfo] = useState<StudentInfo | null>(null);
  const [studentDialogOpen, setStudentDialogOpen] = useState(false);
  const [loadingStudent, setLoadingStudent] = useState(false);

  const credential = useAuthStore((s) => s.credential);

  useEffect(() => {
    if (!credential) return;
    setLoadingStudent(true);
    getStudentInfo(credential)
      .then((s) => setStudentInfo(s))
      .catch(() => {})
      .finally(() => setLoadingStudent(false));
  }, [credential]);

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
    "/dashboard/student": t("app.studentInfo"),
    "/dashboard/me": t("app.me"),
  };
  const pageTitle = titleByPath[pathname] ?? t("app.name");

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace("/login");
    }
  }, [hasHydrated, isAuthenticated, router]);

  function handleLogout() {
    clearCredential();
    toast.success(t("app.logout"));
    router.replace("/login");
  }

  function toggleLocale() {
    setLocale(locale === "zh" ? "en" : "zh");
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
      <Sidebar
        collapsible="icon"
        className="[&_[data-sidebar=menu-button]]:py-3"
      >
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-3 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-3 group-data-[collapsible=icon]:px-0">
            <GraduationCap className="size-6 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[collapsible=icon]:rotate-[12deg] group-data-[collapsible=icon]:scale-110" />
            <span className="font-semibold transition-opacity duration-300 group-data-[collapsible=icon]:hidden">{t("app.name")}</span>
            <SidebarTrigger className="ml-auto transition-transform duration-300 hover:scale-110 active:scale-95 group-data-[collapsible=icon]:ml-0" />
          </div>
        </SidebarHeader>
        <SidebarContent>
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
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <main className="min-w-0 flex-1 overflow-x-hidden pb-16 md:overflow-auto md:pb-0">
        <MobileTopBar title={pageTitle} />
        <header className="hidden items-center justify-between gap-4 border-b px-6 py-4 md:flex">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold animate-in fade-in slide-in-from-left-2 duration-300">
              {navItems.find((i) => i.url === pathname)?.title || t("app.name")}
            </h1>
            <RefreshIndicator />
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={t("app.theme")}
            >
              <Sun className="rotate-0 scale-100 transition-all duration-300 dark:-rotate-90 dark:scale-0" />
              <Moon className="absolute rotate-90 scale-0 transition-all duration-300 dark:rotate-0 dark:scale-100" />
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleLocale}>
              <Globe data-icon="inline-start" />
              {locale === "zh" ? "中文" : "EN"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative size-8 rounded-full">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">
                      {studentInfo?.name?.slice(-2) || username?.slice(-2) || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                <DropdownMenuItem disabled className="flex flex-col items-start gap-0.5">
                  <span className="font-medium text-foreground">{studentInfo?.name || username || t("app.login")}</span>
                  {studentInfo?.student_id && (
                    <span className="text-xs text-muted-foreground">{studentInfo.student_id}</span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStudentDialogOpen(true)}>
                  <User />
                  {t("app.studentInfo")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut />
                  {t("app.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div key={pathname} className="p-4 animate-in fade-in slide-in-from-bottom-2 duration-500 md:p-8">
          {children}
        </div>
      </main>
      <MobileBottomNav />

      <Dialog open={studentDialogOpen} onOpenChange={setStudentDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("student.title")}</DialogTitle>
            <DialogDescription>{t("student.description")}</DialogDescription>
          </DialogHeader>
          {loadingStudent || !studentInfo ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-4 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { label: t("student.fields.name"), value: studentInfo.name },
                { label: t("student.fields.studentId"), value: studentInfo.student_id },
                { label: t("student.fields.pinyin"), value: studentInfo.name_pinyin },
                { label: t("student.fields.gender"), value: studentInfo.gender },
                { label: t("student.fields.nation"), value: studentInfo.nation },
                { label: t("student.fields.nationality"), value: studentInfo.nationality },
                { label: t("student.fields.department"), value: studentInfo.department },
                { label: t("student.fields.major"), value: studentInfo.major },
                { label: t("student.fields.className"), value: studentInfo.class_name },
                { label: t("student.fields.gradeLevel"), value: studentInfo.grade_level },
                { label: t("student.fields.enrollmentDate"), value: studentInfo.enrollment_date },
                { label: t("student.fields.expectedGraduation"), value: studentInfo.expected_graduation },
                { label: t("student.fields.educationLevel"), value: studentInfo.education_level },
                { label: t("student.fields.campus"), value: studentInfo.campus },
                { label: t("student.fields.studentStatus"), value: studentInfo.student_status },
                { label: t("student.fields.studyDuration"), value: studentInfo.study_duration },
                { label: t("student.fields.foreignLanguage"), value: studentInfo.foreign_language },
              ].map((f) => (
                <div key={f.label} className="flex flex-col gap-1">
                  <span className="text-sm text-muted-foreground">{f.label}</span>
                  <span className="font-medium">{f.value || "-"}</span>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
