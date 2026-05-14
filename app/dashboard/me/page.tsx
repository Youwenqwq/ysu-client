"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  BookOpen,
  ChevronRight,
  FileText,
  GraduationCap,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Sun,
  User,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { getStudentInfo } from "@/lib/api";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { resetSDK } from "@/lib/sdk";
import { useUpdateStore } from "@/lib/update-store";
import { APP_VERSION, APP_BUILD } from "@/lib/version";
import type { StudentInfo } from "@/lib/types";

export default function MePage() {
  const router = useRouter();
  const credential = useAuthStore((s) => s.credential);
  const username = useAuthStore((s) => s.username);
  const clearCredential = useAuthStore((s) => s.clearCredential);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!credential) return;
    const cached = cacheGet<StudentInfo>(cacheKey(["student", credential]));
    if (cached) {
      setStudent(cached);
      setLoading(false);
    }
    getStudentInfo(credential)
      .then((s) => {
        setStudent(s);
        cacheSet(cacheKey(["student", credential]), s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [credential]);

  function handleLogout() {
    setLogoutDialogOpen(false);
    clearCredential();
    resetSDK();
    toast.success(t("app.logout"));
    router.replace("/login");
  }

  async function handleRelogin() {
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

  const academicLinks = [
    { href: "/dashboard/student", label: t("app.studentInfo"), icon: User },
    { href: "/dashboard/gpa", label: t("app.gpa"), icon: GraduationCap },
    { href: "/dashboard/exams", label: t("app.exams"), icon: FileText },
    { href: "/dashboard/training-plan", label: t("app.trainingPlan"), icon: BookOpen },
  ];

  const displayName = student?.name || username || t("me.profileFallback");
  const initials = (student?.name || username || "U").slice(-2);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {loading && !student ? (
              <>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-32" />
              </>
            ) : (
              <>
                <span className="truncate text-base font-semibold">{displayName}</span>
                {student?.student_id && (
                  <span className="truncate text-sm text-muted-foreground">
                    {student.student_id}
                  </span>
                )}
                {student?.department && (
                  <span className="truncate text-xs text-muted-foreground md:hidden">
                    {student.department}
                  </span>
                )}
                {(student?.department || student?.major) && (
                  <span className="hidden truncate text-xs text-muted-foreground md:inline">
                    {[student.department, student.major].filter(Boolean).join(" · ")}
                  </span>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Section title={t("me.sectionAcademic")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            {academicLinks.map((item, idx) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 py-3 transition-colors active:bg-muted/60 ${
                  idx > 0 ? "border-t border-border" : ""
                }`}
              >
                <item.icon className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm">{item.label}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title={t("me.sectionPreferences")}>
        <Card>
          <CardContent className="flex flex-col gap-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("app.theme")}</span>
              <ToggleGroup
                type="single"
                value={mounted ? theme ?? "" : ""}
                onValueChange={(v) => v && setTheme(v)}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="light" aria-label={t("app.themeLight")}>
                  <Sun className="size-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label={t("app.themeDark")}>
                  <Moon className="size-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label={t("app.themeSystem")}>
                  <Monitor className="size-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("app.language")}</span>
              <ToggleGroup
                type="single"
                value={locale}
                onValueChange={(v) => v && setLocale(v as "zh" | "en")}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="zh">中文</ToggleGroupItem>
                <ToggleGroupItem value="en">EN</ToggleGroupItem>
              </ToggleGroup>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title={t("me.sectionAccount")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            <button
              type="button"
              onClick={handleRelogin}
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <LogIn className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-left text-sm">{t("app.relogin")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setLogoutDialogOpen(true)}
              className="flex items-center gap-3 border-t border-border py-3 text-destructive transition-colors active:bg-destructive/10"
            >
              <LogOut className="size-5 shrink-0" />
              <span className="flex-1 text-left text-sm">{t("app.logout")}</span>
            </button>
          </CardContent>
        </Card>
      </Section>

      <div className="flex items-center justify-between px-1 pt-2 text-sm">
        <Link
          href="/dashboard/about"
          className="relative text-primary underline underline-offset-2"
        >
          {t("about.title")}
          {hasUpdate && (
            <span className="absolute -top-1 -right-2 size-2 rounded-full bg-destructive" />
          )}
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            v{APP_VERSION} · {APP_BUILD}
          </span>
          {hasUpdate && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {t("me.updateAvailable")}
            </Badge>
          )}
        </div>
      </div>

      <Dialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.logout")}</DialogTitle>
            <DialogDescription>{t("logout.confirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setLogoutDialogOpen(false)}>
              {t("logout.cancel")}
            </Button>
            <Button variant="destructive" onClick={handleLogout}>
              {t("app.logout")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
