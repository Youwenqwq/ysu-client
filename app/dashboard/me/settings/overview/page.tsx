"use client"

import { OverviewEditor } from "@/app/dashboard/overview/overview-composer"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { usePluginStates } from "@/components/plugin-provider"
import { useTranslation } from "@/lib/i18n/use-translation"

export default function OverviewSettingsPage() {
  const { t } = useTranslation()
  const active = usePluginStates().some(
    (state) =>
      state.manifest.id === "orahako.overview" &&
      (state.status === "active" || state.status === "starting")
  )
  if (!active) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t("app.featureUnavailable")}</EmptyTitle>
          <EmptyDescription>{t("app.featureUnavailableDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return <OverviewEditor />
}
