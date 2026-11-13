"use client"

import { useState, useSyncExternalStore } from "react"
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
import { PluginSlot, type PluginSettingsCategory } from "@orahako/plugin-sdk"
import { SettingsSection } from "@/components/settings-section"
import { usePluginHost } from "@/components/plugin-provider"
import { usePluginTranslation } from "@/lib/plugins/use-plugin-translation"

import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit"
import { useUpdateStore } from "@/lib/stores/update"
import { useTheme } from "next-themes"
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
  BarChart3,
} from "lucide-react"

function PluginSettingsCategoryRow({ category }: { category: PluginSettingsCategory }) {
  const { t } = usePluginTranslation(category.pluginId)
  const Icon = category.icon
  return (
    <Link
      href={`/dashboard/me/settings/plugins/?category=${encodeURIComponent(category.id)}`}
      className="group flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
    >
      <div className="rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        <Icon className="size-4.5" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">
          {category.titleKey ? t(category.titleKey) : category.title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {category.descriptionKey ? t(category.descriptionKey) : category.description}
        </span>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { host } = usePluginHost()
  const categories = useSyncExternalStore(
    host.settings.subscribe,
    host.settings.getSnapshot,
    host.settings.getSnapshot
  )
  const { t, locale, setLocale } = useTranslation()
  const { theme, setTheme } = useTheme()
  const hasUpdate = useUpdateStore((s) => s.hasUpdate)

  const defaultLandingPage = useSettingsStore((s) => s.defaultLandingPage)
  const setDefaultLandingPage = useSettingsStore((s) => s.setDefaultLandingPage)
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false)

  const analyticsConsent = useSettingsStore((s) => s.analyticsConsent)
  const setAnalyticsConsent = useSettingsStore((s) => s.setAnalyticsConsent)

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

      {categories.length > 0 && (
        <SettingsSection title={t("settings.pluginSettings")}>
          <Card className="py-0">
            <CardContent className="flex flex-col divide-y divide-border py-1">
              {categories.map((category) => (
                <PluginSettingsCategoryRow
                  key={`${category.pluginId}:${category.id}`}
                  category={category}
                />
              ))}
            </CardContent>
          </Card>
        </SettingsSection>
      )}

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
    </div>
  )
}
