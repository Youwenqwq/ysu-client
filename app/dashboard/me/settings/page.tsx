"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
import { useSettingsStore, type LandingPage } from "@/lib/stores/settings";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/lib/i18n/use-translation";
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service";
import { useProvider } from "@/providers/use-provider";
import { isCapacitor } from "@/lib/native/platform";

import { syncWidgetSettingsToWidget } from "@/lib/native/widget-bridge";
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit";
import { useUpdateStore } from "@/lib/stores/update";
import { useTheme } from "next-themes";
import { startNotifyIfNeeded, stopNativePolling, triggerNotifyCheck } from "@/lib/native/notify";
import { NotifyPlugin } from "@/lib/native/notify-plugin";
import {
  LayoutDashboard,
  Calendar,
  ChevronRight,
  LogIn,
  LogOut,
  Info,
  Image as ImageIcon,
  Sun,
  Globe,
  Clock,
  CalendarClock,
  Sparkles,
  UserCircle,
  Bell,
  Timer,
  AlarmClock,
  Battery,
  ShieldCheck,
  BarChart3,
  WifiOff,
} from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const provider = useProvider();
  const nativeNotification = provider.nativeNotification;
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme } = useTheme();
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);

  const defaultLandingPage = useSettingsStore((s) => s.defaultLandingPage);
  const setDefaultLandingPage = useSettingsStore((s) => s.setDefaultLandingPage);
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours);
  const setWidgetSyncReminderHours = useSettingsStore((s) => s.setWidgetSyncReminderHours);
  const widgetShowNextDaySchedule = useSettingsStore((s) => s.widgetShowNextDaySchedule);
  const setWidgetShowNextDaySchedule = useSettingsStore((s) => s.setWidgetShowNextDaySchedule);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

  const notifyEnabled = useSettingsStore((s) => s.notifyEnabled);
  const setNotifyEnabled = useSettingsStore((s) => s.setNotifyEnabled);
  const notifyCheckInterval = useSettingsStore((s) => s.notifyCheckInterval);
  const setNotifyCheckInterval = useSettingsStore((s) => s.setNotifyCheckInterval);
  const notifyGrades = useSettingsStore((s) => s.notifyGrades);
  const setNotifyGrades = useSettingsStore((s) => s.setNotifyGrades);
  const notifyExams = useSettingsStore((s) => s.notifyExams);
  const setNotifyExams = useSettingsStore((s) => s.setNotifyExams);
  const notifyNetworkError = useSettingsStore((s) => s.notifyNetworkError);
  const setNotifyNetworkError = useSettingsStore((s) => s.setNotifyNetworkError);
  const classReminderEnabled = useSettingsStore((s) => s.classReminderEnabled);
  const setClassReminderEnabled = useSettingsStore((s) => s.setClassReminderEnabled);
  const classReminderMinutes = useSettingsStore((s) => s.classReminderMinutes);
  const setClassReminderMinutes = useSettingsStore((s) => s.setClassReminderMinutes);
  const classReminderDays = useSettingsStore((s) => s.classReminderDays);
  const setClassReminderDays = useSettingsStore((s) => s.setClassReminderDays);
  const analyticsConsent = useSettingsStore((s) => s.analyticsConsent);
  const setAnalyticsConsent = useSettingsStore((s) => s.setAnalyticsConsent);
  const gradeGachaEnabled = useSettingsStore((s) => s.gradeGachaEnabled);
  const setGradeGachaEnabled = useSettingsStore((s) => s.setGradeGachaEnabled);
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | null>(null);
  const [autoStartDialogOpen, setAutoStartDialogOpen] = useState(false);

  // Check battery optimization status on mount and when returning from settings
  useEffect(() => {
    if (!isCapacitor()) return;

    NotifyPlugin.checkBatteryOptimization().then(({ ignored }) => {
      setBatteryIgnored(ignored);
    }).catch(() => {});

    let listener: { remove(): void } | undefined;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          NotifyPlugin.checkBatteryOptimization().then(({ ignored }) => {
            setBatteryIgnored(ignored);
          }).catch(() => {});
        }
      }).then((h) => { listener = h; });
    });

    return () => { listener?.remove(); };
  }, []);

  async function handleLogout() {
    setLogoutDialogOpen(false);
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>

      <Section title={t("me.sectionPreferences")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            {/* 通用 */}
            <h3 className="flex items-center gap-2 px-0.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              {t("settings.general")}
            </h3>

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
              <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("app.backgroundImage")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>

            {/* 小组件 */}
            <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
              {t("settings.widget")}
            </h3>

            {/* 课表同步提醒阈值 */}
            <SettingNumberInput
              icon={Clock}
              label={t("settings.widgetSyncReminder")}
              value={widgetSyncReminderHours}
              onChange={(v) => {
                setWidgetSyncReminderHours(v);
                syncWidgetSettingsToWidget(v, widgetShowNextDaySchedule).catch(() => {});
              }}
              min={0}
              max={168}
              unit={t("settings.widgetSyncReminderUnit")}
            />

            {/* 无课显示下一有课日 */}
            <div className="flex items-center gap-3 border-t border-border py-3">
              <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("settings.widgetShowNextDay")}</span>
              <Switch
                checked={widgetShowNextDaySchedule}
                onCheckedChange={(v) => {
                  setWidgetShowNextDaySchedule(v);
                  syncWidgetSettingsToWidget(widgetSyncReminderHours, v).catch(() => {});
                }}
              />
            </div>

            {/* 新成绩抽卡 */}
            <div className="flex items-center gap-3 border-t border-border py-3">
              <Sparkles className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm">{t("settings.gradeGacha")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("settings.gradeGachaDesc")}
                </span>
              </div>
              <Switch checked={gradeGachaEnabled} onCheckedChange={setGradeGachaEnabled} />
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 通知设置 — 仅 Capacitor 平台 */}
      {isCapacitor() && (
        <Section title={t("settings.notifyTitle")}>
          <Card>
            <CardContent className="flex flex-col py-1">
              {/* 系统权限 */}
              <h3 className="flex items-center gap-2 px-0.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("settings.systemPermissions")}
              </h3>

              {/* 电池优化 */}
              <button
                type="button"
                onClick={() => NotifyPlugin.requestIgnoreBatteryOptimization()}
                className="flex items-center gap-3 py-3 text-left transition-colors active:bg-muted/60"
              >
                <Battery className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.batteryOptimization")}</span>
                  <span className="text-xs text-muted-foreground">{t("settings.batteryOptimizationDesc")}</span>
                </div>
                {batteryIgnored !== null && (
                  <span className={`text-xs ${batteryIgnored ? "text-green-600" : "text-orange-500"}`}>
                    {batteryIgnored ? t("settings.batteryOptimizationIgnored") : t("settings.batteryOptimizationNotIgnored")}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>

              {/* 自启动 */}
              <button
                type="button"
                onClick={() => setAutoStartDialogOpen(true)}
                className="flex items-center gap-3 border-t border-border py-3 text-left transition-colors active:bg-muted/60"
              >
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.autoStart")}</span>
                  <span className="text-xs text-muted-foreground">{t("settings.autoStartDesc")}</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              
              {/* 成绩/考试通知 */}
              <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("settings.notifyContentTitle")}
              </h3>

              {/* 通知开关 */}
              <div className="flex items-center gap-3 py-3">
                <Bell className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.notifyEnabled")}</span>
                  <span className="text-xs text-muted-foreground">{t("settings.notifyEnabledDesc")}</span>
                </div>
                <Switch
                  checked={notifyEnabled}
                  onCheckedChange={(enabled) => {
                    setNotifyEnabled(enabled);
                    if (enabled) {
                      startNotifyIfNeeded(nativeNotification, provider.id).then(() => triggerNotifyCheck()).catch(() => {});
                    } else {
                      stopNativePolling().catch(() => {});
                    }
                  }}
                />
              </div>

              {/* 检查频率 */}
              {notifyEnabled && (
                <SettingNumberInput
                  icon={Timer}
                  label={t("settings.notifyInterval")}
                  description={t("settings.notifyIntervalHint")}
                  value={notifyCheckInterval}
                  onChange={setNotifyCheckInterval}
                  min={15}
                  max={1440}
                  unit={t("settings.notifyIntervalUnit")}
                  bordered
                />
              )}

              {/* 监听内容 */}
              {notifyEnabled && (
                <div className="flex items-center gap-3 border-t border-border py-3">
                  <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm">{t("settings.notifyContent")}</span>
                  <ToggleGroup
                    type="multiple"
                    value={[
                      ...(notifyGrades ? ["grades"] : []),
                      ...(notifyExams ? ["exams"] : []),
                    ]}
                    onValueChange={(v) => {
                      setNotifyGrades(v.includes("grades"));
                      setNotifyExams(v.includes("exams"));
                    }}
                    variant="outline"
                    size="sm"
                  >
                    <ToggleGroupItem value="grades" className="text-xs">
                      {t("settings.notifyGrades")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="exams" className="text-xs">
                      {t("settings.notifyExams")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              )}

              {/* 网络错误提醒 */}
              {notifyEnabled && (
                <div className="flex items-center gap-3 border-t border-border py-3">
                  <WifiOff className="size-5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">{t("settings.notifyNetworkError")}</span>
                    <span className="text-xs text-muted-foreground">{t("settings.notifyNetworkErrorDesc")}</span>
                  </div>
                  <Switch
                    checked={notifyNetworkError}
                    onCheckedChange={setNotifyNetworkError}
                  />
                </div>
              )}

              {/* 上课提醒 */}
              <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("settings.classReminderTitle")}
              </h3>
              <div className="flex items-center gap-3 py-3">
                <AlarmClock className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.classReminderEnabled")}</span>
                  <span className="text-xs text-muted-foreground">{t("settings.classReminderHint")}</span>
                </div>
                <Switch
                  checked={classReminderEnabled}
                  onCheckedChange={setClassReminderEnabled}
                />
              </div>
              {classReminderEnabled && (
                <>
                  <SettingNumberInput
                    icon={Timer}
                    label={t("settings.classReminderMinutes")}
                    value={classReminderMinutes}
                    onChange={setClassReminderMinutes}
                    min={1}
                    max={120}
                    unit={t("settings.minutes")}
                    bordered
                  />
                  <SettingNumberInput
                    icon={CalendarClock}
                    label={t("settings.classReminderDays")}
                    value={classReminderDays}
                    onChange={setClassReminderDays}
                    min={1}
                    max={14}
                    unit={t("settings.days")}
                    bordered
                  />
                </>
              )}
            </CardContent>
          </Card>
        </Section>
      )}

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

      <div className="flex flex-col gap-2">
        <Card>
          <CardContent className="flex flex-col py-1">
            <div className="flex items-center gap-3 py-3">
              <BarChart3 className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm">{t("settings.analyticsEnabled")}</span>
                <span className="text-xs text-muted-foreground">{t("settings.analyticsDesc")}</span>
              </div>
              <Switch
                checked={analyticsConsent}
                onCheckedChange={setAnalyticsConsent}
              />
            </div>
          </CardContent>
        </Card>
      </div>

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

      <Dialog open={autoStartDialogOpen} onOpenChange={setAutoStartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.autoStartDialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.autoStartDialogContent")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAutoStartDialogOpen(false)}>
              {t("dialog.ok")}
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

function SettingNumberInput({
  icon: Icon,
  label,
  description,
  value,
  onChange,
  min,
  max,
  unit,
  bordered,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  unit: string;
  bordered?: boolean;
}) {
  const [local, setLocal] = useState(String(value));

  function commit() {
    const val = parseInt(local, 10);
    const clamped = Math.min(max, Math.max(min, Number.isNaN(val) ? value : val));
    setLocal(String(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <div className={`flex items-center gap-3 py-3${bordered ? " border-t border-border" : ""}`}>
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col">
        <span className="text-sm">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="h-7 w-16 text-right text-sm"
          min={min}
          max={max}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
