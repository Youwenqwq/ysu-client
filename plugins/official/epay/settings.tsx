"use client"

import { Wallet2 } from "lucide-react"
import { Switch } from "@orahako/plugin-ui/components"
import { useHasCapability, useTranslation } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@orahako/plugin-ui/stores"

/** In-app reminder settings contributed to "settings.notifications.appReminders". */
export function EpayNotificationSettings() {
  const { t } = useTranslation()
  const epayActive = useHasCapability("epay")
  const epayNotifyEnabled = useSettingsStore((s) => s.epayNotifyEnabled)
  const setEpayNotifyEnabled = useSettingsStore((s) => s.setEpayNotifyEnabled)

  if (!epayActive) return null

  return (
    <>
      <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
        {t("settings.epayReminderTitle")}
      </h3>

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
    </>
  )
}
