"use client"

import { LayoutDashboard } from "lucide-react"
import { ToggleGroupItem } from "@orahako/plugin-ui/components"
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
