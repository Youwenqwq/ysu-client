import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  AlarmClock,
  Calendar,
  CalendarClock,
  Clock,
  LayoutGrid,
  Plus,
  Radio,
  Timer,
  Vibrate,
} from "lucide-react"
import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
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
import type { ScheduleWidgetId } from "./controller"
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
  if (
    !activeProvider ||
    !supportsPlugin(activeProvider.supportedPlugins, props.pluginId) ||
    !hasSlice(activeProvider, "timetable")
  ) {
    return null
  }

  return (
    <ToggleGroupItem value="schedule" className="gap-1 text-xs">
      <Calendar className="size-3.5" />
      {props.t("settings.startupSchedule")}
    </ToggleGroupItem>
  )
}

export interface ScheduleWidgetsCategoryInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly requestPinWidget: (widget: ScheduleWidgetId) => Promise<boolean>
}

export type ScheduleWidgetsCategoryProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleSettingsStoreInstance,
  ScheduleWidgetsCategoryInject
>

function ScheduleWidgetPinCard({
  widgetId,
  name,
  sizeLabel,
  t,
  onRequestPin,
}: {
  readonly widgetId: ScheduleWidgetId
  readonly name: string
  readonly sizeLabel: string
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
      <CardContent className="mx-4 flex flex-1 flex-col gap-2 rounded-lg bg-muted/35 p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{name}</span>
          <span>08:00 - 09:40</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="h-7 rounded-md bg-primary/15 px-2.5 py-1.5 text-xs font-medium text-foreground">
            1-2 · A101
          </div>
          <div className="h-7 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-foreground">
            3-4 · B203
          </div>
        </div>
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
  const { t, useStore, actions } = props
  const providerSnap = props.useProvider()
  const syncReminderHours = useStore((s) => s.widgetSyncReminderHours)
  const showNextDaySchedule = useStore((s) => s.widgetShowNextDaySchedule)

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

  return (
    <div className="flex flex-col gap-6" data-schedule-widgets-category="">
      <section className="grid gap-4 lg:grid-cols-2" aria-label={t("desktopWidgets.title")}>
        <ScheduleWidgetPinCard
          widgetId="schedule"
          name={t("desktopWidgets.scheduleName")}
          sizeLabel="4×3"
          t={t}
          onRequestPin={props.requestPinWidget}
        />
        <ScheduleWidgetPinCard
          widgetId="tomorrow"
          name={t("desktopWidgets.tomorrowName")}
          sizeLabel="4×2"
          t={t}
          onRequestPin={props.requestPinWidget}
        />
      </section>

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
  )
}

export interface ScheduleWidgetAssistantSettingsInject {
  readonly isNative: () => boolean
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
    <Card data-schedule-widget-assistant-settings="">
      <CardContent className="flex items-center gap-3 py-1">
        <WidgetAssistantAvatar className="size-11 shrink-0" />
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
  }
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly isLiveUpdateSupported: () => boolean
  readonly toggleClassReminder: (enabled: boolean) => Promise<boolean>
  readonly requestExactAlarmPermission: () => Promise<boolean>
  readonly checkExactAlarmPermission: () => Promise<boolean>
}

export type ClassReminderSettingsProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleSettingsStoreInstance,
  ClassReminderSettingsInject
>

export const ClassReminderSettings: SlotComponent<ClassReminderSettingsProps> = (props) => {
  const { t, useStore, actions } = props
  const providerSnap = props.useProvider()
  const classReminderEnabled = useStore((s) => s.classReminderEnabled)
  const classReminderMinutes = useStore((s) => s.classReminderMinutes)
  const classLiveUpdateEnabled = useStore((s) => s.classLiveUpdateEnabled)
  const classVibrationEnabled = useStore((s) => s.classVibrationEnabled)
  const classReminderDays = useStore((s) => s.classReminderDays)

  const [notificationPermissionPending, setNotificationPermissionPending] = useState(false)
  const [liveUpdatePermissionPending, setLiveUpdatePermissionPending] = useState(false)
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
    if (typeof window === "undefined" || typeof document === "undefined") return

    const onReturnToApp = (): void => {
      if (document.visibilityState === "hidden" || !awaitingExactAlarmPermission.current) return
      void props
        .checkExactAlarmPermission()
        .then((granted) => {
          if (granted && awaitingExactAlarmPermission.current) {
            awaitingExactAlarmPermission.current = false
            actions.setClassLiveUpdateEnabled(true)
          }
        })
        .catch(() => {})
    }

    if (typeof window.addEventListener === "function") {
      window.addEventListener("focus", onReturnToApp)
    }
    if (typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onReturnToApp)
    }
    return () => {
      if (typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onReturnToApp)
      }
      if (typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onReturnToApp)
      }
    }
  }, [actions, props, visible])

  if (!visible) return null

  const handleNotificationToggle = async (enabled: boolean): Promise<void> => {
    if (!enabled) awaitingExactAlarmPermission.current = false
    setNotificationPermissionPending(true)
    try {
      const ok = await props.toggleClassReminder(enabled)
      if (!ok && enabled) {
        toast.error(t("settings.notificationPermissionDenied"))
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
      actions.setClassLiveUpdateEnabled(false)
      return
    }
    awaitingExactAlarmPermission.current = true
    setLiveUpdatePermissionPending(true)
    try {
      const granted = await props.requestExactAlarmPermission()
      if (granted) {
        awaitingExactAlarmPermission.current = false
        actions.setClassLiveUpdateEnabled(true)
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
        </>
      )}
    </div>
  )
}
