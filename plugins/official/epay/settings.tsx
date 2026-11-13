"use client"

import { Wallet2 } from "lucide-react"
import { Card, CardContent, SettingsSection, Switch } from "@orahako/plugin-ui/components"
import { useHasCapability, useTranslation } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@orahako/plugin-ui/stores"

/** Settings section contributed into the host "settings.sections" slot. */
export function EpaySettingsSection() {
  const { t } = useTranslation()
  const epayActive = useHasCapability("epay")
  const epayNotifyEnabled = useSettingsStore((s) => s.epayNotifyEnabled)
  const setEpayNotifyEnabled = useSettingsStore((s) => s.setEpayNotifyEnabled)

  if (!epayActive) return null

  return (
    <SettingsSection title={t("settings.epayReminderTitle")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <div className="flex items-center gap-3 py-3">
            <Wallet2 className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{t("epay.remindLabel")}</span>
              <span className="text-xs text-muted-foreground">{t("epay.remindDesc")}</span>
            </div>
            <Switch
              aria-label={t("epay.remindLabel")}
              checked={epayNotifyEnabled}
              onCheckedChange={setEpayNotifyEnabled}
            />
          </div>
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
