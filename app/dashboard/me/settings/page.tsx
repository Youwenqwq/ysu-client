"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useSettingsStore, type LandingPage } from "@/lib/stores/settings"
import { useTranslation } from "@/lib/i18n/use-translation"
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service"
import { isCapacitor } from "@/lib/native/platform"
import { PluginSlot } from "@orahako/plugin-sdk"
import { SettingsSection } from "@/components/settings-section"

import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit"
import { useUpdateStore } from "@/lib/stores/update"
import { useTheme } from "next-themes"
import { NotifyPlugin } from "@/lib/native/notify-plugin"
import {
  LayoutDashboard,
  ChevronRight,
  LogIn,
  LogOut,
  Info,
  Image as ImageIcon,
  Sun,
  Globe,
  UserCircle,
  Battery,
  ShieldCheck,
  BarChart3,
} from "lucide-react"

export default function SettingsPage() {
  const router = useRouter()
  const { t, locale, setLocale } = useTranslation()
  const { theme, setTheme } = useTheme()
  const hasUpdate = useUpdateStore((s) => s.hasUpdate)

  const defaultLandingPage = useSettingsStore((s) => s.defaultLandingPage)
  const setDefaultLandingPage = useSettingsStore((s) => s.setDefaultLandingPage)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  const analyticsConsent = useSettingsStore((s) => s.analyticsConsent)
  const setAnalyticsConsent = useSettingsStore((s) => s.setAnalyticsConsent)
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | null>(null)
  const [autoStartDialogOpen, setAutoStartDialogOpen] = useState(false)
  // Check battery optimization status on mount and when returning from settings
  useEffect(() => {
    if (!isCapacitor()) return

    NotifyPlugin.checkBatteryOptimization()
      .then(({ ignored }) => {
        setBatteryIgnored(ignored)
      })
      .catch(() => {})

    let listener: { remove(): void } | undefined
    import("@capacitor/app").then(({ App }) => {
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          NotifyPlugin.checkBatteryOptimization()
            .then(({ ignored }) => {
              setBatteryIgnored(ignored)
            })
            .catch(() => {})
        }
      }).then((h) => {
        listener = h
      })
    })

    return () => {
      listener?.remove()
    }
  }, [])

  async function handleLogout() {
    setLogoutDialogOpen(false)
    await logoutActiveProvider()
    toast.success(t("app.logout"))
    router.replace("/login")
  }

  async function handleRelogin() {
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

    try {
      const success = await reloginActiveProvider()
      if (success) {
        toast.success(t("login.loginSuccess"))
        return
      }
    } catch {
      // fall through
    }
    await logoutActiveProvider()
    router.replace("/login")
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t("settings.title")}</h1>

      <SettingsSection title={t("me.sectionPreferences")}>
        <Card className="py-0">
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
                <PluginSlot name="settings.startupOptions" />
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
                <ToggleGroupItem value="zh" className="text-xs">
                  中文
                </ToggleGroupItem>
                <ToggleGroupItem value="en" className="text-xs">
                  EN
                </ToggleGroupItem>
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
          </CardContent>
        </Card>
      </SettingsSection>

      {/* 通知设置 — 仅 Capacitor 平台 */}
      {isCapacitor() && (
        <SettingsSection title={t("settings.notifyTitle")}>
          <Card className="py-0">
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
                <Battery className="size-5 shrink-0 translate-x-0.5 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.batteryOptimization")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.batteryOptimizationDesc")}
                  </span>
                </div>
                {batteryIgnored !== null && (
                  <span
                    className={`text-xs ${batteryIgnored ? "text-green-600" : "text-orange-500"}`}
                  >
                    {batteryIgnored
                      ? t("settings.batteryOptimizationIgnored")
                      : t("settings.batteryOptimizationNotIgnored")}
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
                  <span className="text-xs text-muted-foreground">
                    {t("settings.autoStartDesc")}
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </CardContent>
          </Card>
        </SettingsSection>
      )}

      <PluginSlot name="settings.sections" />

      <SettingsSection title={t("me.sectionAccount")}>
        <Card className="py-0">
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
      </SettingsSection>

      <div className="flex flex-col gap-2">
        <Card className="py-0">
          <CardContent className="flex flex-col py-1">
            <div className="flex items-center gap-3 py-3">
              <BarChart3 className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm">{t("settings.analyticsEnabled")}</span>
                <span className="text-xs text-muted-foreground">{t("settings.analyticsDesc")}</span>
              </div>
              <Switch checked={analyticsConsent} onCheckedChange={setAnalyticsConsent} />
            </div>
          </CardContent>
        </Card>
      </div>

      <SettingsSection title={t("about.title")}>
        <Card className="py-0">
          <CardContent className="flex flex-col py-1">
            <Link
              href="/dashboard/me/about"
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <Info className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("about.title")}</span>
              {hasUpdate && <span className="size-2 rounded-full bg-destructive" />}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </SettingsSection>

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
            <Button onClick={() => setAutoStartDialogOpen(false)}>{t("dialog.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
