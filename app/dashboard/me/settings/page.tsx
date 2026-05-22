"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore, type LandingPage } from "@/lib/settings-store";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { resetSDK } from "@/lib/sdk";
import { syncWidgetSettingsToWidget } from "@/lib/widget-bridge";
import { checkRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { useUpdateStore } from "@/lib/update-store";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Calendar,
  ChevronRight,
  LogIn,
  LogOut,
  Info,
  Image,
  Sun,
  Globe,
  Clock,
  UserCircle,
} from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const clearCredential = useAuthStore((s) => s.clearCredential);
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);

  const defaultLandingPage = useSettingsStore((s) => s.defaultLandingPage);
  const setDefaultLandingPage = useSettingsStore((s) => s.setDefaultLandingPage);
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours);
  const setWidgetSyncReminderHours = useSettingsStore((s) => s.setWidgetSyncReminderHours);

  const [localSyncHours, setLocalSyncHours] = useState(String(widgetSyncReminderHours));
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  function commitSyncHours() {
    const val = parseInt(localSyncHours, 10);
    const clamped = Math.min(168, Math.max(0, Number.isNaN(val) ? widgetSyncReminderHours : val));
    setLocalSyncHours(String(clamped));
    if (clamped !== widgetSyncReminderHours) {
      setWidgetSyncReminderHours(clamped);
      syncWidgetSettingsToWidget(clamped).catch(() => {});
    }
  }

  function handleLogout() {
    setLogoutDialogOpen(false);
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>

      <Section title={t("me.sectionPreferences")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            {/* 启动页面 */}
            <div className="flex items-center gap-3 py-3">
              <LayoutDashboard className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("settings.startupPage")}</span>
              <ToggleGroup
                type="single"
                value={defaultLandingPage}
                onValueChange={(v) => v && setDefaultLandingPage(v as LandingPage)}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="overview" className="gap-1 text-xs">
                  <LayoutDashboard className="size-3.5" />
                  {t("settings.startupOverview")}
                </ToggleGroupItem>
                <ToggleGroupItem value="schedule" className="gap-1 text-xs">
                  <Calendar className="size-3.5" />
                  {t("settings.startupSchedule")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* 主题 */}
            <div className="flex items-center gap-3 border-t border-border py-3">
              <Sun className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("app.theme")}</span>
              <ToggleGroup
                type="single"
                value={theme ?? "system"}
                onValueChange={(v) => v && setTheme(v)}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="light" className="text-xs">
                  {t("app.themeLight")}
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" className="text-xs">
                  {t("app.themeDark")}
                </ToggleGroupItem>
                <ToggleGroupItem value="system" className="text-xs">
                  {t("settings.themeAuto")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* 语言 */}
            <div className="flex items-center gap-3 border-t border-border py-3">
              <Globe className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("app.language")}</span>
              <ToggleGroup
                type="single"
                value={locale}
                onValueChange={(v) => v && setLocale(v as "zh" | "en")}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="zh" className="text-xs">中文</ToggleGroupItem>
                <ToggleGroupItem value="en" className="text-xs">EN</ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* 课表同步提醒阈值 */}
            <div className="flex items-center gap-3 border-t border-border py-3">
              <Clock className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("settings.widgetSyncReminder")}</span>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={localSyncHours}
                  onChange={(e) => setLocalSyncHours(e.target.value)}
                  onBlur={commitSyncHours}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      commitSyncHours();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-7 w-16 text-right text-sm"
                  min={0}
                  max={168}
                />
                <span className="text-sm text-muted-foreground">{t("settings.widgetSyncReminderUnit")}</span>
              </div>
            </div>

            {/* 头像 */}
            <Link
              href="/dashboard/me/avatar"
              className="flex items-center gap-3 border-t border-border py-3 transition-colors active:bg-muted/60"
            >
              <UserCircle className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("app.avatarSettings")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>

            {/* 背景图 */}
            <Link
              href="/dashboard/me/background"
              className="flex items-center gap-3 border-t border-border py-3 transition-colors active:bg-muted/60"
            >
              <Image className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("app.backgroundImage")}</span>
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

      <Section title={t("about.title")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            <Link
              href="/dashboard/me/about"
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <Info className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("about.title")}</span>
              {hasUpdate && (
                <span className="size-2 rounded-full bg-destructive" />
              )}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </Section>

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
