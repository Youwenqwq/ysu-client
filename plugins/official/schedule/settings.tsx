"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Device } from "@capacitor/device"
import { toast } from "sonner"
import {
  AlarmClock,
  Calendar,
  CalendarClock,
  ChevronRight,
  Clock,
  LayoutGrid,
  Radio,
  Timer,
  Vibrate,
} from "lucide-react"
import {
  Card,
  CardContent,
  SettingNumberInput,
  SettingsSection,
  Switch,
  ToggleGroupItem,
  cn,
} from "@orahako/plugin-ui/components"
import { useProvider, useProviderCapabilities, useTranslation } from "@orahako/plugin-ui/hooks"
import { useSettingsStore } from "@orahako/plugin-ui/stores"
import { buroImage } from "@orahako/plugin-ui/assets"
import {
  checkExactAlarmPermission,
  isCapacitor,
  requestExactAlarmPermission,
  setNotificationEnabled,
  syncWidgetSettingsToWidget,
} from "@orahako/plugin-ui/platform"

export function ScheduleStartupOption() {
  const { t } = useTranslation()
  const capabilities = useProviderCapabilities()

  if (!capabilities.schedule) return null

  return (
    <ToggleGroupItem value="schedule" className="gap-1 text-xs">
      <Calendar className="size-3.5" />
      {t("settings.startupSchedule")}
    </ToggleGroupItem>
  )
}

export function ScheduleWidgetSettingsSection() {
  const { t } = useTranslation()
  const capabilities = useProviderCapabilities()
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours)
  const setWidgetSyncReminderHours = useSettingsStore((s) => s.setWidgetSyncReminderHours)
  const widgetShowNextDaySchedule = useSettingsStore((s) => s.widgetShowNextDaySchedule)
  const setWidgetShowNextDaySchedule = useSettingsStore((s) => s.setWidgetShowNextDaySchedule)

  if (!isCapacitor() || !capabilities.schedule) return null

  return (
    <SettingsSection title={t("settings.widget")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <Link
            href="/dashboard/me/settings/widgets"
            className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
          >
            <LayoutGrid className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{t("settings.addWidget")}</span>
              <span className="text-xs text-muted-foreground">{t("settings.addWidgetDesc")}</span>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>

          <SettingNumberInput
            icon={Clock}
            label={t("settings.widgetSyncReminder")}
            value={widgetSyncReminderHours}
            onChange={(v) => {
              setWidgetSyncReminderHours(v)
              syncWidgetSettingsToWidget(v, widgetShowNextDaySchedule).catch(() => {})
            }}
            min={0}
            max={168}
            unit={t("settings.widgetSyncReminderUnit")}
            bordered
          />

          <div className="flex items-center gap-3 border-t border-border py-3">
            <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("settings.widgetShowNextDay")}</span>
            <Switch
              checked={widgetShowNextDaySchedule}
              onCheckedChange={(v) => {
                setWidgetShowNextDaySchedule(v)
                syncWidgetSettingsToWidget(widgetSyncReminderHours, v).catch(() => {})
              }}
            />
          </div>
        </CardContent>
      </Card>
    </SettingsSection>
  )
}

export function ScheduleWidgetAssistantSettings() {
  const { t } = useTranslation()
  const assistantHidden = useSettingsStore((s) => s.widgetAssistantHidden)
  const setAssistantHidden = useSettingsStore((s) => s.setWidgetAssistantHidden)

  if (!isCapacitor()) return null

  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-1">
        <Image src={buroImage} alt="" className="size-11 shrink-0 object-contain" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{t("desktopWidgets.assistantToggle")}</span>
          <span className="text-xs text-muted-foreground">
            {t("desktopWidgets.assistantToggleDesc")}
          </span>
        </div>
        <Switch
          aria-label={t("desktopWidgets.assistantToggle")}
          checked={!assistantHidden}
          onCheckedChange={(visible) => setAssistantHidden(!visible)}
        />
      </CardContent>
    </Card>
  )
}

export function ClassReminderSettingsSection() {
  const { t } = useTranslation()
  const provider = useProvider()
  const capabilities = useProviderCapabilities()
  const classReminderEnabled = useSettingsStore((s) => s.classReminderEnabled)
  const classReminderMinutes = useSettingsStore((s) => s.classReminderMinutes)
  const setClassReminderMinutes = useSettingsStore((s) => s.setClassReminderMinutes)
  const classLiveUpdateEnabled = useSettingsStore((s) => s.classLiveUpdateEnabled)
  const setClassLiveUpdateEnabled = useSettingsStore((s) => s.setClassLiveUpdateEnabled)
  const classVibrationEnabled = useSettingsStore((s) => s.classVibrationEnabled)
  const setClassVibrationEnabled = useSettingsStore((s) => s.setClassVibrationEnabled)
  const classReminderDays = useSettingsStore((s) => s.classReminderDays)
  const setClassReminderDays = useSettingsStore((s) => s.setClassReminderDays)

  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false)
  const [liveUpdatePermissionPending, setLiveUpdatePermissionPending] = useState(false)
  const awaitingExactAlarmPermission = useRef(false)
  const [liveUpdateSupported, setLiveUpdateSupported] = useState(false)

  const visible = isCapacitor() && capabilities.schedule && !!provider.nativeNotification

  useEffect(() => {
    if (!visible) return
    let mounted = true
    Device.getInfo()
      .then((info) => {
        if (mounted) {
          setLiveUpdateSupported(info.platform === "android" && (info.androidSDKVersion ?? 0) >= 36)
        }
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [visible])

  useEffect(() => {
    if (!visible) return

    let listener: { remove(): void } | undefined
    let disposed = false
    import("@capacitor/app").then(({ App }) => {
      if (disposed) return
      App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive || !awaitingExactAlarmPermission.current) return
        checkExactAlarmPermission()
          .then(({ granted }) => {
            if (granted && awaitingExactAlarmPermission.current) {
              awaitingExactAlarmPermission.current = false
              setClassLiveUpdateEnabled(true)
            }
          })
          .catch(() => {})
      }).then((handle) => {
        if (disposed) handle.remove()
        else listener = handle
      })
    })

    return () => {
      disposed = true
      listener?.remove()
    }
  }, [visible, setClassLiveUpdateEnabled])

  if (!visible) return null

  async function handleNotificationToggle(enabled: boolean) {
    if (!enabled) awaitingExactAlarmPermission.current = false
    setNotificationPermissionPending(true)
    try {
      if (!(await setNotificationEnabled("classes", enabled))) {
        toast.error(t("settings.notificationPermissionDenied"))
      }
    } catch {
      toast.error(t("settings.notificationSyncFailed"))
    } finally {
      setNotificationPermissionPending(false)
    }
  }

  async function handleLiveUpdateToggle(enabled: boolean) {
    if (!enabled) {
      awaitingExactAlarmPermission.current = false
      setClassLiveUpdateEnabled(false)
      return
    }
    awaitingExactAlarmPermission.current = true
    setLiveUpdatePermissionPending(true)
    try {
      const { granted } = await requestExactAlarmPermission()
      if (granted) {
        awaitingExactAlarmPermission.current = false
        setClassLiveUpdateEnabled(true)
      } else {
        toast.info(t("settings.classLiveUpdateExactAlarmRequired"))
      }
    } catch {
      awaitingExactAlarmPermission.current = false
      toast.error(t("settings.notificationSyncFailed"))
    } finally {
      setLiveUpdatePermissionPending(false)
    }
  }

  return (
    <SettingsSection title={t("settings.classReminderTitle")}>
      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <div className="flex items-center gap-3 py-3">
            <AlarmClock className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{t("settings.classReminderEnabled")}</span>
              <span className="text-xs text-muted-foreground">
                {t("settings.classReminderHint")}
              </span>
            </div>
            <Switch
              checked={classReminderEnabled}
              disabled={notificationPermissionPending}
              onCheckedChange={(enabled) => void handleNotificationToggle(enabled)}
            />
          </div>

          {classReminderEnabled && (
            <>
              <div className="flex items-center gap-3 border-t border-border py-3">
                <Radio className="size-5 shrink-0 text-muted-foreground" />
                <label
                  htmlFor="class-live-update"
                  className={cn(
                    "min-w-0 flex-1 text-sm",
                    !liveUpdateSupported && "text-muted-foreground"
                  )}
                >
                  {t("settings.classLiveUpdateEnabled")}
                </label>
                <Switch
                  id="class-live-update"
                  checked={liveUpdateSupported && classLiveUpdateEnabled}
                  disabled={!liveUpdateSupported || liveUpdatePermissionPending}
                  onCheckedChange={(enabled) => void handleLiveUpdateToggle(enabled)}
                />
              </div>

              <div className="flex items-center gap-3 border-t border-border py-3">
                <Vibrate className="size-5 shrink-0 text-muted-foreground" />
                <label htmlFor="class-vibration" className="min-w-0 flex-1 text-sm">
                  {t("settings.classVibrationEnabled")}
                </label>
                <Switch
                  id="class-vibration"
                  checked={classVibrationEnabled}
                  onCheckedChange={setClassVibrationEnabled}
                />
              </div>

              <SettingNumberInput
                icon={Timer}
                label={t("settings.classReminderMinutes")}
                value={classReminderMinutes}
                onChange={setClassReminderMinutes}
                min={1}
                max={120}
                unit={t("settings.minutes")}
                bordered
              />

              <SettingNumberInput
                icon={CalendarClock}
                label={t("settings.classReminderDays")}
                value={classReminderDays}
                onChange={setClassReminderDays}
                min={1}
                max={14}
                unit={t("settings.days")}
                bordered
              />
            </>
          )}
        </CardContent>
      </Card>
    </SettingsSection>
  )
}
