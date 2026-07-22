"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FilePenLine,
  FileText,
  Gauge,
  Hammer,
  Lightbulb,
  LogIn,
  Settings,
  Sun,
  Moon,
} from "lucide-react";
import { useAuthStore } from "@/lib/stores/auth";
import { useSettingsStore } from "@/lib/stores/settings";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/stores/mobile-header";
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service";
import { useStudentInfo } from "@/providers/hooks";
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit";
import { useTheme } from "next-themes";
import { APP_VERSION, APP_BUILD } from "@/lib/version";

export default function MePage() {
  const router = useRouter();
  const username = useAuthStore((s) => s.username);
  const { t } = useTranslation();
  const { theme, setTheme, systemTheme } = useTheme();

  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const student = useStudentInfo();

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

  const avatarImage = useSettingsStore((s) => s.avatarImage);


  const displayName = student.data?.name || username || t("me.profileFallback");
  const initials = (student.data?.name || username || "U").slice(-2);

  const academicItems = [
    { href: "/dashboard/exams", label: t("app.exams"), icon: FileText },
    { href: "/dashboard/makeup-exams", label: t("app.makeupExams"), icon: FilePenLine },
    { href: "/dashboard/training-plan", label: t("app.trainingPlan"), icon: BookOpen },
    { href: "/dashboard/evaluation", label: t("app.evaluation"), icon: ClipboardCheck },
  ];

  const platformItems = [
    { href: "/dashboard/labor", label: t("app.labor"), icon: Hammer },
    { href: "/dashboard/credits", label: t("app.credits"), icon: Lightbulb },
    { href: "/dashboard/comprehensive", label: t("app.comprehensive"), icon: Gauge },
    { href: "/dashboard/school-schedule", label: t("app.schoolSchedule"), icon: CalendarDays },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/me/student" className="block">
        <Card className="transition-colors hover:bg-muted/40 active:bg-muted/60">
          <CardContent className="flex items-center gap-4 py-5">
          <Avatar className="size-14">
            {avatarImage && <AvatarImage src={avatarImage} alt="avatar" />}
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {student.isLoading && !student.data ? (
              <>
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-32" />
              </>
            ) : (
              <>
                <span className="truncate text-base font-semibold">{displayName}</span>
                {student.data?.studentId && (
                  <span className="truncate text-sm text-muted-foreground">
                    {student.data.studentId}
                  </span>
                )}
                {student.data?.department && (
                  <span className="truncate text-xs text-muted-foreground md:hidden">
                    {student.data.department}
                  </span>
                )}
                {(student.data?.department || student.data?.major) && (
                  <span className="hidden truncate text-xs text-muted-foreground md:inline">
                    {[student.data.department, student.data.major].filter(Boolean).join(" · ")}
                  </span>
                )}
              </>
            )}
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
      </Link>

      <Section title={t("me.sectionAcademic")}>
        <Card>
          <CardContent className="grid grid-cols-4 gap-y-4 py-4">
            {academicItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1.5 rounded-lg py-1 transition-colors active:bg-muted/60"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                  <item.icon className="size-5 text-primary" />
                </span>
                <span className="text-center text-xs leading-tight">{item.label}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title={t("me.sectionPlatforms")}>
        <Card>
          <CardContent className="grid grid-cols-4 gap-y-4 py-4">
            {platformItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center gap-1.5 rounded-lg py-1 transition-colors active:bg-muted/60"
              >
                <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                  <item.icon className="size-5 text-primary" />
                </span>
                <span className="text-center text-xs leading-tight">{item.label}</span>
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
