"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronRight, LogIn, Settings, Sun, Moon } from "lucide-react"
import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { useStoredMediaUrl } from "@/lib/storage/media"
import { loadAvatarImage } from "@/lib/storage/avatar"
import { logoutActiveProvider, reloginActiveProvider } from "@/providers/provider-service"
import { useStudentInfo } from "@/providers/hooks"
import { checkRateLimit, recordLoginAttempt, rateLimitMessage } from "@/lib/rate-limit"
import { useTheme } from "next-themes"
import { APP_VERSION, APP_BUILD } from "@/lib/version"
import { EXTRA_FEATURES } from "@/lib/extras/registry"
import { FEE_FEATURES } from "@/lib/fees/registry"
import { ACADEMIC_NAV_GROUPS } from "@/lib/dashboard-nav"
import { isDashboardFeatureAvailable } from "@/lib/dashboard-features"
import { useProviderCapabilities } from "@/providers/use-provider"

export default function MePage() {
  const router = useRouter()
  const username = useAuthStore((s) => s.username)
  const { t } = useTranslation()
  const { theme, setTheme, systemTheme } = useTheme()

  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const student = useStudentInfo()

  const isSystem = theme === "system"
  const effectiveTheme = isSystem ? systemTheme : theme

  function handleThemeToggle() {
    if (isSystem) {
      setTheme("light")
    } else {
      setTheme(theme === "light" ? "dark" : "light")
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
        {effectiveTheme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
      </Button>
    ) : null,
    [mounted, effectiveTheme, t]
  )

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

  const avatarImage = useSettingsStore((s) => s.avatarImage)
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage)

  const displayName = student.data?.name || username || t("me.profileFallback")
  const initials = (student.data?.name || username || "U").slice(-2)

  const capabilities = useProviderCapabilities()
  const academicItems = (
    ACADEMIC_NAV_GROUPS.find((g) => g.labelKey === "me.sectionAcademic")?.features ?? []
  )
    .filter((f) => isDashboardFeatureAvailable(f, capabilities))
    .map((f) => ({ href: f.nav.url, label: t(f.nav.titleKey), icon: f.nav.icon }))

  const platformItems = (
    ACADEMIC_NAV_GROUPS.find((g) => g.labelKey === "me.sectionPlatforms")?.features ?? []
  )
    .filter((f) => isDashboardFeatureAvailable(f, capabilities))
    .map((f) => ({ href: f.nav.url, label: t(f.nav.titleKey), icon: f.nav.icon }))

  const feeItems = FEE_FEATURES.filter((f) => isDashboardFeatureAvailable(f, capabilities)).map(
    (f) => ({
      href: f.nav.url,
      label: t(f.nav.titleKey),
      icon: f.nav.icon,
    })
  )
  // 玩具箱入口（移动端经"我的"页进入；桌面端走侧边栏）
  const extraItems = EXTRA_FEATURES.map((f) => ({
    href: f.nav.url,
    label: t(f.nav.titleKey),
    icon: f.nav.icon,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/me/student" className="block">
        <Card className="transition-colors hover:bg-muted/40 active:bg-muted/60">
          <CardContent className="flex items-center gap-4 py-5">
            <Avatar className="size-14">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
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

      {academicItems.length > 0 && (
        <Section title={t("me.sectionAcademic")}>
          <LinkCard items={academicItems} />
        </Section>
      )}

      {platformItems.length > 0 && (
        <Section title={t("me.sectionPlatforms")}>
          <LinkCard items={platformItems} />
        </Section>
      )}

      {feeItems.length > 0 && (
        <Section title={t("fees.nav")}>
          <LinkCard items={feeItems} />
        </Section>
      )}

      {extraItems.length > 0 && (
        <Section title={t("extras.nav")}>
          <LinkCard items={extraItems} />
        </Section>
      )}

      <Section title={t("me.sectionPreferences")}>
        <LinkCard
          items={[
            {
              href: "/dashboard/me/settings",
              label: t("me.settings"),
              icon: Settings,
            },
          ]}
        />
      </Section>

      <Section title={t("me.sectionAccount")}>
        <Card>
          <CardContent className="flex flex-col py-1">
            <button
              type="button"
              onClick={handleRelogin}
              className="flex items-center gap-3 border-l-[3px] border-l-transparent py-3 pl-2 transition-colors hover:border-l-brand hover:bg-muted/40 active:bg-muted/60"
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
          className="relative text-brand underline underline-offset-2"
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
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="hud-label px-1">{title}</h2>
      {children}
    </section>
  )
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/** 分隔线列表行卡片：muted 图标 + 标签 + ChevronRight。 */
function LinkCard({ items }: { items: ReadonlyArray<NavItem> }) {
  return (
    <Card>
      <CardContent className="flex flex-col py-1">
        {items.map((item, idx) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 border-l-[3px] border-l-transparent py-3 pl-2 transition-colors hover:border-l-brand hover:bg-muted/40 active:bg-muted/60",
              idx > 0 && "border-t border-t-edge/20"
            )}
          >
            <item.icon className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">{item.label}</span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
