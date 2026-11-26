import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  AlarmClock,
  Bell,
  Calendar,
  CalendarClock,
  CalendarSync,
  Clock,
  LayoutGrid,
  Plus,
  Radio,
  RefreshCw,
  Timer,
  Trash2,
  Vibrate,
} from "lucide-react"
import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  SettingNumberInput,
  Switch,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import type { CalendarSyncStatus, ClassAlarmConfig, ScheduleWidgetId } from "./controller"
import type { ScheduleDictionary } from "./dictionary"
import type { ScheduleSettingsStoreInstance } from "./stores"
import { WidgetAssistantAvatar } from "./widget-discovery"

export interface ScheduleStartupOptionInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
}

export type ScheduleStartupOptionProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  undefined,
  ScheduleStartupOptionInject
>

export const ScheduleStartupOption: SlotComponent<ScheduleStartupOptionProps> = (props) => {
  const providerSnap = props.useProvider()
  const activeProvider = providerSnap.provider
  if (activeProvider && !supportsPlugin(activeProvider.supportedPlugins, props.pluginId)) {
    return null
  }

  return (
    <ToggleGroupItem value="schedule" className="gap-1 text-xs">
      <Calendar className="size-3.5" />
      {props.t("settings.startupSchedule")}
    </ToggleGroupItem>
  )
}

export const SCHEDULE_WIDGETS_CATEGORY_CHILDREN = {
  "settings.widgets": { kind: "list" },
  "settings.widgets.add": { kind: "list" },
} as const

export interface ScheduleWidgetsCategoryInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly location: ObservableSource<RouteLocation>
  }
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly previewSrc: string
  readonly requestPinWidget: (widget: ScheduleWidgetId) => Promise<boolean>
}

export type ScheduleWidgetsCategoryProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  typeof SCHEDULE_WIDGETS_CATEGORY_CHILDREN,
  ScheduleSettingsStoreInstance,
  ScheduleWidgetsCategoryInject
>

function ScheduleWidgetPinCard({
  widgetId,
  name,
  sizeLabel,
  previewSrc,
  t,
  onRequestPin,
}: {
  readonly widgetId: ScheduleWidgetId
  readonly name: string
  readonly sizeLabel: string
  readonly previewSrc: string
  readonly t: Translator<ScheduleDictionary>
  readonly onRequestPin: (widget: ScheduleWidgetId) => Promise<boolean>
}): ReactNode {
  const [adding, setAdding] = useState(false)

  const handlePin = async (): Promise<void> => {
    if (adding) return
    setAdding(true)
    const added = await onRequestPin(widgetId)
    setAdding(false)
    if (added) {
      toast.success(t("desktopWidgets.added"))
    } else {
      toast.info(t("desktopWidgets.unsupported"))
      if (typeof document !== "undefined") {
        document.getElementById("widget-manual-guide")?.scrollIntoView?.({
          behavior: "smooth",
          block: "start",
        })
      }
    }
  }

  return (
    <Card className="h-full" data-widget-pin-card={widgetId}>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardAction>
          <Badge variant="secondary">{sizeLabel}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="mx-4 flex flex-1 items-center justify-center rounded-lg bg-muted/35 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewSrc} alt={name} className="h-auto w-full rounded-lg" />
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={adding}
          data-widget-pin-button={widgetId}
          onClick={() => void handlePin()}
        >
          <Plus data-icon="inline-start" />
          {adding ? t("desktopWidgets.adding") : t("desktopWidgets.add")}
        </Button>
      </CardFooter>
    </Card>
  )
}

export const ScheduleWidgetsCategoryPanel: SlotComponent<ScheduleWidgetsCategoryProps> = (
  props
) => {
  const { t, useStore, actions, renderSlot } = props
  const providerSnap = props.useProvider()
  const location = props.useLocation()
  const syncReminderHours = useStore((s) => s.widgetSyncReminderHours)
  const showNextDaySchedule = useStore((s) => s.widgetShowNextDaySchedule)
  const [addWidgetsOpen, setAddWidgetsOpen] = useState(location.params.expand === "add")
  const autoExpandAddWidgets = location.params.expand === "add"

  useEffect(() => {
    if (autoExpandAddWidgets) setAddWidgetsOpen(true)
  }, [autoExpandAddWidgets])

  const activeProvider = providerSnap.provider
  const supported =
    Boolean(activeProvider) &&
    supportsPlugin(activeProvider?.supportedPlugins, props.pluginId) &&
    hasSlice(activeProvider, "timetable")

  if (!props.isNative() || !supported) {
    return (
      <Empty className="min-h-48" data-widgets-native-only="">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutGrid />
          </EmptyMedia>
          <EmptyTitle>{t("desktopWidgets.title")}</EmptyTitle>
          <EmptyDescription>{t("desktopWidgets.nativeOnly")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const manualSteps = [
    t("desktopWidgets.manualStep1"),
    t("desktopWidgets.manualStep2"),
    t("desktopWidgets.manualStep3"),
    t("desktopWidgets.manualStep4"),
  ]
  const widgetSettingsNode = renderSlot("settings.widgets")
  const addWidgetNodes = renderSlot("settings.widgets.add")

  return (
    <div className="flex flex-col gap-6" data-schedule-widgets-category="">
      {widgetSettingsNode}

      <Card className="py-0">
        <CardContent className="flex flex-col py-1">
          <SettingNumberInput
            icon={Clock}
            label={t("settings.widgetSyncReminder")}
            value={syncReminderHours}
            onChange={actions.setWidgetSyncReminderHours}
            min={0}
            max={168}
            unit={t("settings.widgetSyncReminderUnit")}
          />

          <div className="flex items-center gap-3 border-t border-border py-3">
            <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
            <span className="flex-1 text-sm">{t("settings.widgetShowNextDay")}</span>
            <Switch
              aria-label={t("settings.widgetShowNextDay")}
              checked={showNextDaySchedule}
              onCheckedChange={actions.setWidgetShowNextDaySchedule}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="py-0">
        <Accordion
          type="single"
          collapsible
          value={addWidgetsOpen ? "add" : ""}
          onValueChange={(value) => setAddWidgetsOpen(value === "add")}
        >
          <AccordionItem value="add" className="border-b-0">
            <AccordionTrigger className="px-4 py-3 hover:no-underline">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span>{t("settings.addWidget")}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t("settings.addWidgetDesc")}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="h-auto px-4 pb-4">
              <div className="flex flex-col gap-6">
                <section
                  className="grid gap-4 lg:grid-cols-2"
                  aria-label={t("desktopWidgets.title")}
                >
                  <ScheduleWidgetPinCard
                    widgetId="schedule"
                    name={t("desktopWidgets.scheduleName")}
                    sizeLabel="4×3"
                    previewSrc={props.previewSrc}
                    t={t}
                    onRequestPin={props.requestPinWidget}
                  />
                  <ScheduleWidgetPinCard
                    widgetId="tomorrow"
                    name={t("desktopWidgets.tomorrowName")}
                    sizeLabel="4×2"
                    previewSrc={props.previewSrc}
                    t={t}
                    onRequestPin={props.requestPinWidget}
                  />
                  {addWidgetNodes}
                </section>

                <Card id="widget-manual-guide" className="scroll-mt-20">
                  <CardHeader>
                    <CardTitle>{t("desktopWidgets.manualTitle")}</CardTitle>
                    <CardDescription>{t("desktopWidgets.manualDescription")}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4">
                    <ol className="grid gap-4 md:grid-cols-2">
                      {manualSteps.map((step, index) => (
                        <li key={step} className="flex items-start gap-3 text-sm leading-6">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                      <p>{t("desktopWidgets.resizeNote")}</p>
                      <p>{t("desktopWidgets.syncNote")}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Card>
    </div>
  )
}

export interface ScheduleWidgetAssistantSettingsInject {
  readonly isNative: () => boolean
  readonly assistantSrc: string
}

export type ScheduleWidgetAssistantSettingsProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleSettingsStoreInstance,
  ScheduleWidgetAssistantSettingsInject
>

export const ScheduleWidgetAssistantSettings: SlotComponent<
  ScheduleWidgetAssistantSettingsProps
> = (props) => {
  const { t, useStore, actions } = props
  const assistantHidden = useStore((s) => s.widgetAssistantHidden)

  if (!props.isNative()) return null

  return (
    <Card className="py-0" data-schedule-widget-assistant-settings="">
      <CardContent className="flex min-h-18 items-center gap-3 py-3">
        <WidgetAssistantAvatar src={props.assistantSrc} className="size-11 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{t("desktopWidgets.assistantToggle")}</span>
          <span className="text-xs text-muted-foreground">
            {t("desktopWidgets.assistantToggleDesc")}
          </span>
        </div>
        <Switch
          aria-label={t("desktopWidgets.assistantToggle")}
          checked={!assistantHidden}
          onCheckedChange={(visible) => actions.setWidgetAssistantHidden(!visible)}
        />
      </CardContent>
    </Card>
  )
}

export interface ClassReminderSettingsInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly scheduledAlarms: ObservableSource<readonly ClassAlarmConfig[]>
    readonly calendarSyncStatus: ObservableSource<CalendarSyncStatus>
  }
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly isLiveUpdateSupported: () => boolean
  readonly toggleClassReminder: (enabled: boolean) => Promise<boolean>
  readonly requestExactAlarmPermission: () => Promise<boolean>
  readonly checkExactAlarmPermission: () => Promise<boolean>
  readonly openNotificationSettings?: () => Promise<boolean>
  readonly toggleCalendarSync?: (enabled: boolean) => Promise<boolean>
  readonly syncCalendarNow?: () => Promise<void>
  readonly clearSystemCalendar?: () => Promise<void>
}

export type ClassReminderSettingsProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleSettingsStoreInstance,
  ClassReminderSettingsInject
>

function formatAlarmTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ""
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${month}-${day} ${hours}:${minutes}`
}

export const ClassReminderSettings: SlotComponent<ClassReminderSettingsProps> = (props) => {
  const { t, useStore, actions, checkExactAlarmPermission } = props
  const { setClassLiveUpdateEnabled } = actions
  const providerSnap = props.useProvider()
  const scheduledAlarms = props.useScheduledAlarms()
  const calendarSyncStatus = props.useCalendarSyncStatus()
  const classReminderEnabled = useStore((s) => s.classReminderEnabled)
  const classReminderMinutes = useStore((s) => s.classReminderMinutes)
  const classLiveUpdateEnabled = useStore((s) => s.classLiveUpdateEnabled)
  const classVibrationEnabled = useStore((s) => s.classVibrationEnabled)
  const classReminderDays = useStore((s) => s.classReminderDays)
  const calendarSyncEnabled = useStore((s) => s.calendarSyncEnabled)
  const calendarSyncIncludeExams = useStore((s) => s.calendarSyncIncludeExams)
  const calendarSyncWriteReminders = useStore((s) => s.calendarSyncWriteReminders)

  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false)
  const [liveUpdatePermissionPending, setLiveUpdatePermissionPending] = useState(false)
  const [calendarSyncPending, setCalendarSyncPending] = useState(false)
  const [exactAlarmGranted, setExactAlarmGranted] = useState<boolean | null>(null)
  const awaitingExactAlarmPermission = useRef(false)

  const activeProvider = providerSnap.provider
  const visible =
    props.isNative() &&
    Boolean(activeProvider) &&
    supportsPlugin(activeProvider?.supportedPlugins, props.pluginId) &&
    hasSlice(activeProvider, "timetable")
  const liveUpdateSupported = props.isLiveUpdateSupported()

  useEffect(() => {
    if (!visible) return
    let disposed = false
    let listener: { remove(): void | Promise<void> } | undefined

    const refreshExactAlarm = (): void => {
      void checkExactAlarmPermission()
        .then((granted) => {
          if (disposed) return
          setExactAlarmGranted(granted)
          if (granted && awaitingExactAlarmPermission.current) {
            awaitingExactAlarmPermission.current = false
            setClassLiveUpdateEnabled(true)
          }
        })
        .catch(() => {})
    }

    const onReturnToApp = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      refreshExactAlarm()
    }

    refreshExactAlarm()
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", onReturnToApp)
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onReturnToApp)
    }
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refreshExactAlarm()
        })
      )
      .then((handle) => {
        if (disposed) {
          void handle.remove()
        } else {
          listener = handle
        }
      })
      .catch(() => {})

    return () => {
      disposed = true
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onReturnToApp)
      }
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onReturnToApp)
      }
      void listener?.remove()
    }
  }, [checkExactAlarmPermission, setClassLiveUpdateEnabled, visible])

  if (!visible) return null

  const handleNotificationToggle = async (enabled: boolean): Promise<void> => {
    if (!enabled) awaitingExactAlarmPermission.current = false
    setNotificationPermissionPending(true)
    try {
      const ok = await props.toggleClassReminder(enabled)
      if (!ok && enabled) {
        if (props.openNotificationSettings) {
          toast.error(t("settings.notificationPermissionDenied"), {
            action: {
              label: t("settings.notificationOpenSettings"),
              onClick: () => {
                void props.openNotificationSettings?.()
              },
            },
          })
        } else {
          toast.error(t("settings.notificationPermissionDenied"))
        }
        return
      }
      if (ok && enabled) {
        const exactGranted = await checkExactAlarmPermission().catch(() => true)
        setExactAlarmGranted(exactGranted)
        if (!exactGranted) {
          toast.info(t("settings.classReminderExactAlarmHint"), {
            action: {
              label: t("settings.classReminderExactAlarmAction"),
              onClick: () => {
                void props.requestExactAlarmPermission()
              },
            },
          })
        }
      }
    } catch {
      toast.error(t("settings.notificationSyncFailed"))
    } finally {
      setNotificationPermissionPending(false)
    }
  }

  const handleLiveUpdateToggle = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      awaitingExactAlarmPermission.current = false
      setClassLiveUpdateEnabled(false)
      return
    }
    awaitingExactAlarmPermission.current = true
    setLiveUpdatePermissionPending(true)
    try {
      const granted = await props.requestExactAlarmPermission()
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

  const handleCalendarSyncToggle = async (enabled: boolean): Promise<void> => {
    if (!props.toggleCalendarSync) return
    setCalendarSyncPending(true)
    try {
      const ok = await props.toggleCalendarSync(enabled)
      if (!ok && enabled) {
        toast.error(t("settings.calendarSyncPermissionDenied"))
      } else if (ok && !enabled) {
        toast.success(t("settings.calendarSyncCleared"))
      }
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  const handleSyncCalendarNow = async (): Promise<void> => {
    if (!props.syncCalendarNow) return
    setCalendarSyncPending(true)
    try {
      await props.syncCalendarNow()
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  const handleClearSystemCalendar = async (): Promise<void> => {
    if (!props.clearSystemCalendar) return
    setCalendarSyncPending(true)
    try {
      await props.clearSystemCalendar()
      toast.success(t("settings.calendarSyncCleared"))
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  return (
    <div data-class-reminder-settings="">
      <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
        {t("settings.classReminderTitle")}
      </h3>

      <div className="flex items-center gap-3 py-3">
        <AlarmClock className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col">
          <span className="text-sm">{t("settings.classReminderEnabled")}</span>
          <span className="text-xs text-muted-foreground">{t("settings.classReminderHint")}</span>
        </div>
        <Switch
          aria-label={t("settings.classReminderEnabled")}
          checked={classReminderEnabled}
          disabled={notificationPermissionPending}
          onCheckedChange={(enabled) => void handleNotificationToggle(enabled)}
        />
      </div>

      {classReminderEnabled && (
        <>
          {exactAlarmGranted === false && (
            <div
              data-exact-alarm-warning=""
              className="flex items-center justify-between gap-2 border-t border-border py-2.5 text-xs text-orange-600 dark:text-orange-400"
            >
              <span className="min-w-0 flex-1">{t("settings.classReminderExactAlarmHint")}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => void props.requestExactAlarmPermission()}
              >
                {t("settings.classReminderExactAlarmAction")}
              </Button>
            </div>
          )}

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
              onCheckedChange={actions.setClassVibrationEnabled}
            />
          </div>

          <SettingNumberInput
            icon={Timer}
            label={t("settings.classReminderMinutes")}
            value={classReminderMinutes}
            onChange={actions.setClassReminderMinutes}
            min={1}
            max={120}
            unit={t("settings.minutes")}
            bordered
          />

          <SettingNumberInput
            icon={CalendarClock}
            label={t("settings.classReminderDays")}
            value={classReminderDays}
            onChange={actions.setClassReminderDays}
            min={1}
            max={14}
            unit={t("settings.days")}
            bordered
          />

          <div className="border-t border-border">
            <Accordion type="single" collapsible>
              <AccordionItem value="preview" className="border-b-0">
                <AccordionTrigger
                  className="py-3 text-sm font-normal hover:no-underline"
                  data-reminder-preview-trigger=""
                >
                  <span className="flex items-center gap-2">
                    <span>{t("settings.classReminderPreviewTitle")}</span>
                    <Badge variant="secondary" className="text-[11px]">
                      {scheduledAlarms.length}
                    </Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pb-3" data-reminder-preview-content="">
                  {scheduledAlarms.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.classReminderPreviewEmpty")}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {scheduledAlarms.slice(0, 10).map((alarm) => {
                        const startAt =
                          alarm.startAt ?? alarm.alarmTime + alarm.remindMinutes * 60_000
                        const isEvent = alarm.category === "event"
                        return (
                          <li
                            key={`${alarm.alarmId}-${alarm.alarmTime}`}
                            className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-2 text-xs"
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                  {t(
                                    isEvent
                                      ? "settings.classReminderCategoryEvent"
                                      : "settings.classReminderCategoryCourse"
                                  )}
                                </Badge>
                                <span className="truncate font-medium">{alarm.courseName}</span>
                              </div>
                              <span className="text-muted-foreground">
                                {[
                                  `${formatAlarmTimestamp(startAt)}${alarm.endTime ? `-${alarm.endTime}` : ""}`,
                                  alarm.classroom,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </div>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {t("settings.classReminderTriggerAt", {
                                time: formatAlarmTimestamp(alarm.alarmTime),
                              })}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </>
      )}

      {props.toggleCalendarSync && (
        <div data-calendar-sync-settings="">
          <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
            {t("settings.calendarSyncTitle")}
          </h3>

          <div className="flex items-center gap-3 py-3">
            <CalendarSync className="size-5 shrink-0 text-muted-foreground" />
            <div className="flex flex-1 flex-col">
              <span className="text-sm">{t("settings.calendarSyncEnabled")}</span>
              <span className="text-xs text-muted-foreground">
                {t("settings.calendarSyncHint")}
              </span>
            </div>
            <Switch
              aria-label={t("settings.calendarSyncEnabled")}
              checked={calendarSyncEnabled}
              disabled={calendarSyncPending}
              onCheckedChange={(enabled) => void handleCalendarSyncToggle(enabled)}
            />
          </div>

          {calendarSyncEnabled && (
            <>
              <div className="flex items-center gap-3 border-t border-border py-3">
                <Calendar className="size-5 shrink-0 text-muted-foreground" />
                <label htmlFor="calendar-sync-exams" className="min-w-0 flex-1 text-sm">
                  {t("settings.calendarSyncIncludeExams")}
                </label>
                <Switch
                  id="calendar-sync-exams"
                  checked={calendarSyncIncludeExams}
                  onCheckedChange={actions.setCalendarSyncIncludeExams}
                />
              </div>

              <div className="flex items-center gap-3 border-t border-border py-3">
                <Bell className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <label htmlFor="calendar-sync-reminders" className="text-sm">
                    {t("settings.calendarSyncWriteReminders")}
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.calendarSyncWriteRemindersHint")}
                  </span>
                </div>
                <Switch
                  id="calendar-sync-reminders"
                  checked={calendarSyncWriteReminders}
                  onCheckedChange={actions.setCalendarSyncWriteReminders}
                />
              </div>

              {classReminderEnabled && calendarSyncWriteReminders && (
                <div
                  data-calendar-duplicate-warning=""
                  className="mb-2 rounded-md border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs text-orange-700 dark:text-orange-300"
                >
                  {t("settings.calendarSyncDuplicateWarning")}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-3">
                <span className="text-xs text-muted-foreground">
                  {calendarSyncStatus.syncing
                    ? t("settings.calendarSyncSyncing")
                    : calendarSyncStatus.error
                      ? calendarSyncStatus.error
                      : calendarSyncStatus.lastSyncedCount !== null
                        ? t("settings.calendarSyncSyncedCount", {
                            count: calendarSyncStatus.lastSyncedCount,
                          })
                        : t("settings.calendarSyncTitle")}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={calendarSyncPending || calendarSyncStatus.syncing}
                    onClick={() => void handleSyncCalendarNow()}
                  >
                    <RefreshCw className="mr-1 size-3.5" />
                    {t("settings.calendarSyncNow")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={calendarSyncPending || calendarSyncStatus.syncing}
                    onClick={() => void handleClearSystemCalendar()}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    {t("settings.calendarSyncClear")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
