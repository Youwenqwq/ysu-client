"use client"

import { Sparkles } from "lucide-react"
import {
  Card,
  CardContent,
  SettingsSection,
  Switch,
  ToggleGroupItem,
} from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@orahako/plugin-ui/stores"

/** Gacha toggle, contributed into the host "settings.sections" slot. */
export function GradesGachaSettingsSection() {
  const { t } = useTranslation()
  const gradeGachaEnabled = useSettingsStore((s) => s.gradeGachaEnabled)
  const setGradeGachaEnabled = useSettingsStore((s) => s.setGradeGachaEnabled)

  return (
    <SettingsSection title={t("app.grades")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <div className="flex items-center gap-3 py-3">
            <Sparkles className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{t("settings.gradeGacha")}</span>
              <span className="text-xs text-muted-foreground">{t("settings.gradeGachaDesc")}</span>
            </div>
            <Switch checked={gradeGachaEnabled} onCheckedChange={setGradeGachaEnabled} />
          </div>
        </CardContent>
      </Card>
    </SettingsSection>
  )
}

/** Grade notification option, contributed into the host "settings.notificationContent" slot. */
export function GradeNotificationContent() {
  const { t } = useTranslation()

  return (
    <ToggleGroupItem value="grades" className="text-xs">
      {t("settings.notifyGrades")}
    </ToggleGroupItem>
  )
}
