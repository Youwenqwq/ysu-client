"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  ChevronRight,
  FileText,
  GraduationCap,
  LogIn,
  Settings,
  Sun,
  Moon,
  User,
} from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore } from "@/lib/settings-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/mobile-header-store";
import { getStudentInfo } from "@/lib/api";
import { cacheGet, cacheSet, cacheKey } from "@/lib/cache";
import { resetSDK } from "@/lib/sdk";
import { checkRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { useUpdateStore } from "@/lib/update-store";
import { useTheme } from "next-themes";
import { APP_VERSION, APP_BUILD } from "@/lib/version";
import type { StudentInfo } from "@/lib/types";

export default function MePage() {
  const router = useRouter();
  const credential = useAuthStore((s) => s.credential);
  const username = useAuthStore((s) => s.username);
  const { t } = useTranslation();
  const { theme, setTheme, systemTheme } = useTheme();

  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

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

  const isSystem = theme === "system";
  const effectiveTheme = isSystem ? systemTheme : theme;

  function handleThemeToggle() {
    if (isSystem) {
      setTheme("light");
    } else {
      setTheme(theme === "light" ? "dark" : "light");
    }
  }

  useMobileHeaderRight(
    mounted ? (
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleThemeToggle}
        aria-label={t("app.theme")}
      >
        {effectiveTheme === "dark" ? (
          <Moon className="size-4" />
        ) : (
          <Sun className="size-4" />
        )}
      </Button>
    ) : null,
    [mounted, effectiveTheme, t]
  );

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
    const clearCredential = useAuthStore.getState().clearCredential;
    clearCredential();
    resetSDK();
    router.replace("/login");
  }

  const academicLinks = [
    { href: "/dashboard/me/student", label: t("app.studentInfo"), icon: User },
    { href: "/dashboard/me/gpa", label: t("app.gpa"), icon: GraduationCap },
    { href: "/dashboard/exams", label: t("app.exams"), icon: FileText, mobileOnly: true },
    { href: "/dashboard/training-plan", label: t("app.trainingPlan"), icon: BookOpen, mobileOnly: true },
  ];

  const avatarImage = useSettingsStore((s) => s.avatarImage);

  const displayName = student?.name || username || t("me.profileFallback");
  const initials = (student?.name || username || "U").slice(-2);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex items-center gap-4 py-5">
          <Avatar className="size-14">
            {avatarImage && <AvatarImage src={avatarImage} alt="avatar" />}
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
            {academicLinks
              .filter((item) => !item.mobileOnly)
              .map((item, idx) => (
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
            {academicLinks
              .filter((item) => item.mobileOnly)
              .map((item, idx, arr) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 py-3 transition-colors active:bg-muted/60 md:hidden ${
                    idx > 0 || academicLinks.filter((i) => !i.mobileOnly).length > 0 ? "border-t border-border" : ""
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
          <CardContent className="flex flex-col py-1">
            <Link
              href="/dashboard/me/settings"
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <Settings className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("me.settings")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
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
          </CardContent>
        </Card>
      </Section>

      <div className="flex items-center justify-between px-1 pt-2 text-sm">
        <Link
          href="/dashboard/me/about"
          className="relative text-primary underline underline-offset-2"
        >
          {t("about.title")}
        </Link>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            v{APP_VERSION} · {APP_BUILD}
          </span>
        </div>
      </div>
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
