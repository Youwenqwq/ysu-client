"use client"

import { useEffect, useState } from "react"
import {
  Battery,
  Bell,
  CalendarClock,
  ChevronRight,
  ShieldCheck,
  Timer,
  WifiOff,
} from "lucide-react"
import { toast } from "sonner"
import { PluginSlot, usePluginSlotHasContributions } from "@orahako/plugin-sdk"
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  SettingNumberInput,
  Switch,
  ToggleGroup,
} from "@orahako/plugin-ui/components"
import { useProvider, useTranslation } from "@orahako/plugin-ui/hooks"
import { isCapacitor, NotifyPlugin, setNotificationEnabled } from "@orahako/plugin-ui/platform"
import { useSettingsStore } from "@orahako/plugin-ui/stores"

/**
 * The single notification settings panel: system permissions, general polling
 * and the reminders contributed by other plugins share one card, split into
 * sections by small headings and dividers.
 */
export function NotificationSettingsPanel() {
  const { t } = useTranslation()
  const provider = useProvider()
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
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | null>(null)
  const [autoStartDialogOpen, setAutoStartDialogOpen] = useState(false)

  const native = isCapacitor()
  const hasPollingSettings = native && !!provider.nativeNotification
  const hasAppReminders = usePluginSlotHasContributions("settings.notifications.appReminders")
  const visible = native || hasAppReminders

  // Check battery optimization status on mount and when returning from settings.
  useEffect(() => {
    if (!native) return

    let disposed = false
    let listener: { remove(): void } | undefined
    const refreshBatteryStatus = () => {
      NotifyPlugin.checkBatteryOptimization()
        .then(({ ignored }) => {
          if (!disposed) setBatteryIgnored(ignored)
        })
        .catch(() => {})
    }

    refreshBatteryStatus()
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refreshBatteryStatus()
        })
      )
      .then((handle) => {
        if (disposed) handle.remove()
        else listener = handle
      })

    return () => {
      disposed = true
      listener?.remove()
    }
  }, [native])

  if (!visible) {
    return (
      <Empty className="min-h-48">
        <EmptyHeader>
          <EmptyTitle>{t("app.featureUnavailable")}</EmptyTitle>
          <EmptyDescription>{t("app.featureUnavailableDesc")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

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
    <>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          {native && (
            <>
              {/* 系统权限 */}
              <h3 className="flex items-center gap-2 px-0.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("settings.systemPermissions")}
              </h3>

              {/* 电池优化 */}
              <button
                type="button"
                onClick={() => NotifyPlugin.requestIgnoreBatteryOptimization()}
                className="flex items-center gap-3 py-3 text-left transition-colors active:bg-muted/60"
              >
                <Battery className="size-5 shrink-0 translate-x-0.5 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.batteryOptimization")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.batteryOptimizationDesc")}
                  </span>
                </div>
                {batteryIgnored !== null && (
                  <span
                    className={`text-xs ${batteryIgnored ? "text-green-600" : "text-orange-500"}`}
                  >
                    {batteryIgnored
                      ? t("settings.batteryOptimizationIgnored")
                      : t("settings.batteryOptimizationNotIgnored")}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>

              {/* 自启动 */}
              <button
                type="button"
                onClick={() => setAutoStartDialogOpen(true)}
                className="flex items-center gap-3 border-t border-border py-3 text-left transition-colors active:bg-muted/60"
              >
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("settings.autoStart")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.autoStartDesc")}
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </>
          )}

          {hasPollingSettings && (
            <>
              <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("settings.notifyPolling")}
              </h3>
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
                    <PluginSlot name="settings.notifications.content" />
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
            </>
          )}

          {native && <PluginSlot name="settings.notifications.reminders" />}
          <PluginSlot name="settings.notifications.appReminders" />
        </CardContent>
      </Card>

      <Dialog open={autoStartDialogOpen} onOpenChange={setAutoStartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.autoStartDialogTitle")}</DialogTitle>
            <DialogDescription>{t("settings.autoStartDialogContent")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAutoStartDialogOpen(false)}>{t("dialog.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
