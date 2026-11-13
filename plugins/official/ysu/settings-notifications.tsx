"use client"

import { useState } from "react"
import { Bell, CalendarClock, Timer, WifiOff } from "lucide-react"
import { toast } from "sonner"
import { PluginSlot } from "@orahako/plugin-sdk"
import {
  Card,
  CardContent,
  SettingNumberInput,
  SettingsSection,
  Switch,
  ToggleGroup,
} from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { isCapacitor, setNotificationEnabled } from "@orahako/plugin-ui/platform"
import { useSettingsStore } from "@orahako/plugin-ui/stores"

/** Polling notification settings, contributed into the host "settings.sections" slot. */
export function NotifySettingsSection() {
  const { t } = useTranslation()
  const notifyEnabled = useSettingsStore((s) => s.notifyEnabled)
  const notifyCheckInterval = useSettingsStore((s) => s.notifyCheckInterval)
  const setNotifyCheckInterval = useSettingsStore((s) => s.setNotifyCheckInterval)
  const notifyGrades = useSettingsStore((s) => s.notifyGrades)
  const setNotifyGrades = useSettingsStore((s) => s.setNotifyGrades)
  const notifyExams = useSettingsStore((s) => s.notifyExams)
  const setNotifyExams = useSettingsStore((s) => s.setNotifyExams)
  const notifyNetworkError = useSettingsStore((s) => s.notifyNetworkError)
  const setNotifyNetworkError = useSettingsStore((s) => s.setNotifyNetworkError)
  const [permissionPending, setPermissionPending] = useState(false)

  if (!isCapacitor()) return null

  async function handleToggle(enabled: boolean) {
    setPermissionPending(true)
    try {
      if (!(await setNotificationEnabled("polling", enabled))) {
        toast.error(t("settings.notificationPermissionDenied"))
      }
    } catch {
      toast.error(t("settings.notificationSyncFailed"))
    } finally {
      setPermissionPending(false)
    }
  }

  return (
    <SettingsSection title={t("settings.notifyTitle")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          {/* 通知开关 */}
          <div className="flex items-center gap-3 py-3">
            <Bell className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{t("settings.notifyEnabled")}</span>
              <span className="text-xs text-muted-foreground">
                {t("settings.notifyEnabledDesc")}
              </span>
            </div>
            <Switch
              aria-label={t("settings.notifyEnabled")}
              checked={notifyEnabled}
              disabled={permissionPending}
              onCheckedChange={(enabled) => void handleToggle(enabled)}
            />
          </div>

          {/* 检查频率 */}
          {notifyEnabled && (
            <SettingNumberInput
              icon={Timer}
              label={t("settings.notifyInterval")}
              description={t("settings.notifyIntervalHint")}
              value={notifyCheckInterval}
              onChange={setNotifyCheckInterval}
              min={15}
              max={1440}
              unit={t("settings.notifyIntervalUnit")}
              bordered
            />
          )}

          {/* 监听内容 */}
          {notifyEnabled && (
            <div className="flex items-center gap-3 border-t border-border py-3">
              <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("settings.notifyContent")}</span>
              <ToggleGroup
                type="multiple"
                value={[...(notifyGrades ? ["grades"] : []), ...(notifyExams ? ["exams"] : [])]}
                onValueChange={(value) => {
                  setNotifyGrades(value.includes("grades"))
                  setNotifyExams(value.includes("exams"))
                }}
                variant="outline"
                size="sm"
              >
                <PluginSlot name="settings.notificationContent" />
              </ToggleGroup>
            </div>
          )}

          {/* 网络错误提醒 */}
          {notifyEnabled && (
            <div className="flex items-center gap-3 border-t border-border py-3">
              <WifiOff className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex flex-1 flex-col">
                <span className="text-sm">{t("settings.notifyNetworkError")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("settings.notifyNetworkErrorDesc")}
                </span>
              </div>
              <Switch
                aria-label={t("settings.notifyNetworkError")}
                checked={notifyNetworkError}
                onCheckedChange={setNotifyNetworkError}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
