"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Card,
  CardContent,
  Skeleton,
  cn,
} from "@orahako/plugin-ui/components"
import { ChevronRight, LogIn, Puzzle, Settings } from "lucide-react"
import { ThemeToggle } from "../components/theme-toggle"
import { useMobileHeaderRight, useSettingsStore } from "@orahako/plugin-ui/stores"
import { loadAvatarImage } from "@/plugins/official/shell/media/avatar"
import { useStoredMediaUrl } from "@/plugins/official/shell/media/media"
import { useSessionSnapshot, useTranslation } from "@orahako/plugin-ui/hooks"
import { useStudentInfo } from "@orahako/academic"
import { APP_BUILD, APP_VERSION } from "@orahako/plugin-ui/platform"
import {
  checkRateLimit,
  recordLoginAttempt,
  rateLimitMessage,
} from "@/plugins/official/runtime/login-rate-limit"
import { usePluginServices, useSemanticNavigation } from "@orahako/plugin-ui/plugin"
import {
  pluginPageHref,
  type AcademicPluginContext,
  type PluginAppNavigationDefinition,
  type PluginI18nRegistryService,
  type PluginNavigationContribution,
  type PluginNavigationGroup,
} from "@orahako/plugin-sdk"

type MeNavigation = PluginNavigationContribution & PluginAppNavigationDefinition
type MeServices = AcademicPluginContext & { i18n: PluginI18nRegistryService }

export function MePage() {
  const router = useRouter()
  const { username } = useSessionSnapshot()
  const { t, locale } = useTranslation()
  const services = usePluginServices<MeServices>()
  const nav = useSemanticNavigation()
  // The profile card links to the student-info page via its stable semantic route;
  // when the contributing plugin is missing or disabled the entry hides entirely.
  const pluginNavigation = services.navigation.forScope<MeNavigation>("app")
  const studentInfoHref = nav.href("student-info")

  const student = useStudentInfo()

  useMobileHeaderRight(<ThemeToggle />)

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
      const success = await services.provider.relogin()
      if (success) {
        toast.success(t("login.loginSuccess"))
        return
      }
    } catch {
      // fall through
    }
    await services.provider.logout()
    router.replace("/login")
  }

  const avatarImage = useSettingsStore((s) => s.avatarImage)
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage)

  const displayName = student.data?.name || username || t("me.profileFallback")
  const initials = (student.data?.name || username || "U").slice(-2)

  const pluginItems = (group: PluginNavigationGroup) =>
    pluginNavigation
      .filter((item) => item.group === group)
      .map((item) => ({
        href: pluginPageHref(item.pluginId, item.page),
        label: item.titleKey
          ? services.i18n.translate(item.pluginId, item.titleKey, locale)
          : item.title,
        icon: item.icon,
      }))
  const academicItems = pluginItems("academic")
  const platformItems = pluginItems("platform")
  const feeItems = pluginItems("fees")
  // 玩具箱入口（移动端经"我的"页进入；桌面端走侧边栏）
  const extraItems = [...pluginItems("extras"), ...pluginItems("plugins")]

  return (
    <div className="flex flex-col gap-4">
      {studentInfoHref && (
        <Link href={studentInfoHref} className="block">
          <Card className="py-0 transition-colors hover:bg-muted/40 active:bg-muted/60">
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
      )}

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
            {
              href: "/dashboard/me/plugins",
              label: t("plugins.title"),
              icon: Puzzle,
            },
          ]}
        />
      </Section>

      <Section title={t("me.sectionAccount")}>
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
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
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
    <Card className="py-0">
      <CardContent className="flex flex-col py-1">
        {items.map((item, idx) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 py-3 transition-colors active:bg-muted/60",
              idx > 0 && "border-t border-border"
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
