"use client"

import Link from "next/link"
import { ChevronRight, LayoutDashboard } from "lucide-react"
import { Card, CardContent, SettingsSection, ToggleGroupItem } from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"

/** Startup-page option contributed into the host "settings.startupOptions" slot. */
export function OverviewStartupOption() {
  const { t } = useTranslation()
  return (
    <ToggleGroupItem value="overview" className="gap-1 text-xs">
      <LayoutDashboard className="size-3.5" />
      {t("settings.startupOverview")}
    </ToggleGroupItem>
  )
}

/** Settings section contributed into the host "settings.sections" slot. */
export function OverviewSettingsSection() {
  const { t } = useTranslation()
  return (
    <SettingsSection title={t("app.overview")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <Link
            href="/dashboard/me/settings/overview"
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
          >
            <LayoutDashboard className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{t("overviewLayout.customize")}</span>
              <span className="text-xs text-muted-foreground">
                {t("overviewLayout.settingsDescription")}
              </span>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
