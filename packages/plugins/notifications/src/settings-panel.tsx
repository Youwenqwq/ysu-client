import { useEffect, useState } from "react"
import {
  AlarmClock,
  Battery,
  Bell,
  CalendarClock,
  ChevronRight,
  ShieldCheck,
  Timer,
  WifiOff,
} from "lucide-react"
import { toast } from "sonner"
import {
  hasSlice,
  type AcademicNotificationChannel,
  type ProviderRuntimeSnapshot,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginSlotRegistrySnapshot,
  SlotComponent,
} from "@orahako/sdk"
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
} from "@orahako/ui-primitives"
import { evaluateNotificationChannels } from "./controller"
import "./slots"
import type { NotificationSettingsStoreInstance, NotificationsDictionary } from "./store"

export const NOTIFICATION_CATEGORY_CHILDREN = {
  "settings.notifications.content": { kind: "list" },
  "settings.notifications.reminders": { kind: "list" },
  "settings.notifications.appReminders": { kind: "list" },
} as const

export interface NotificationSettingsInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly channels: ObservableSource<readonly AcademicNotificationChannel[]>
    readonly slotsSnapshot: ObservableSource<PluginSlotRegistrySnapshot>
  }
  readonly isNative: () => boolean
  readonly checkBatteryOptimization: () => Promise<boolean | null>
  readonly requestBatteryOptimizationExemption: () => Promise<boolean>
  readonly checkExactAlarmPermission?: () => Promise<boolean | null>
  readonly requestExactAlarmPermission?: () => Promise<boolean>
  readonly openNotificationSettings?: () => Promise<boolean>
  readonly requestNotificationPermission: () => Promise<boolean>
  readonly togglePollingEnabled: (enabled: boolean) => Promise<boolean>
}

export type NotificationSettingsPanelProps = DerivedComponentProps<
  Record<string, never>,
  NotificationsDictionary,
  typeof NOTIFICATION_CATEGORY_CHILDREN,
  NotificationSettingsStoreInstance,
  NotificationSettingsInject
>

export const NotificationSettingsPanel: SlotComponent<NotificationSettingsPanelProps> = (props) => {
  const { t, useStore, actions, renderSlot } = props
  const providerSnap = props.useProvider()
  const channels = props.useChannels()
  const slotsSnapshot = props.useSlotsSnapshot()

  const enabled = useStore((s) => s.enabled)
  const checkInterval = useStore((s) => s.checkInterval)
  const notifyNetworkError = useStore((s) => s.notifyNetworkError)
  const disabledChannels = useStore((s) => s.disabledChannels)

  const [permissionPending, setPermissionPending] = useState(false)
  const [batteryIgnored, setBatteryIgnored] = useState<boolean | null>(null)
  const [exactAlarmGranted, setExactAlarmGranted] = useState<boolean | null>(null)
  const [autoStartDialogOpen, setAutoStartDialogOpen] = useState(false)

  const native = props.isNative()
  const activeProvider = providerSnap.provider
  const hasPollingSettings = native && hasSlice(activeProvider, "nativePolling")

  const hasAppReminders = slotsSnapshot.contributions.some(
    (entry) => entry.slot === "settings.notifications.appReminders"
  )
  const hasContentSlotItems = slotsSnapshot.contributions.some(
    (entry) => entry.slot === "settings.notifications.content"
  )
  const visible = native || hasAppReminders

  const plan = evaluateNotificationChannels(channels, activeProvider, disabledChannels)
  const pollingChannelIds = plan.channels
    .filter((item) => item.supported && item.participatesInPolling)
    .map((item) => item.channel.id)
  const enabledPollingChannelIds = plan.channels
    .filter((item) => item.active && item.participatesInPolling)
    .map((item) => item.channel.id)

  const { checkBatteryOptimization, checkExactAlarmPermission } = props
  useEffect(() => {
    if (!native) return
    let disposed = false
    let listener: { remove(): void | Promise<void> } | undefined

    const refreshSystemPermissions = () => {
      void checkBatteryOptimization()
        .then((ignored) => {
          if (!disposed) setBatteryIgnored(ignored)
        })
        .catch(() => {})
      if (checkExactAlarmPermission) {
        void checkExactAlarmPermission()
          .then((granted) => {
            if (!disposed) setExactAlarmGranted(granted)
          })
          .catch(() => {})
      }
    }

    const onReturnToApp = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      refreshSystemPermissions()
    }

    refreshSystemPermissions()
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", onReturnToApp)
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onReturnToApp)
    }
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refreshSystemPermissions()
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
  }, [native, checkBatteryOptimization, checkExactAlarmPermission])

  if (!visible) {
    return (
      <Empty className="min-h-48">
        <EmptyHeader>
          <EmptyTitle>{t("unavailable.title")}</EmptyTitle>
          <EmptyDescription>{t("unavailable.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const showPermissionDeniedToast = () => {
    if (props.openNotificationSettings) {
      toast.error(t("permissions.permissionDenied"), {
        action: {
          label: t("permissions.openSettings"),
          onClick: () => {
            void props.openNotificationSettings?.()
          },
        },
      })
      return
    }
    toast.error(t("permissions.permissionDenied"))
  }

  async function handleToggle(nextEnabled: boolean) {
    setPermissionPending(true)
    try {
      if (!nextEnabled) {
        await props.togglePollingEnabled(false)
        return
      }
      if (!(await props.requestNotificationPermission())) {
        showPermissionDeniedToast()
        return
      }
      const applied = await props.togglePollingEnabled(true)
      if (!applied) {
        showPermissionDeniedToast()
      }
    } catch {
      toast.error(t("permissions.syncFailed"))
    } finally {
      setPermissionPending(false)
    }
  }

  return (
    <>
      <Card data-notification-settings="" className="py-0">
        <CardContent className="flex flex-col py-1">
          {native && (
            <>
              <h3 className="flex items-center gap-2 px-0.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("permissions.sectionTitle")}
              </h3>

              {props.requestExactAlarmPermission && (
                <button
                  type="button"
                  onClick={() => {
                    void props.requestExactAlarmPermission?.().then((granted) => {
                      setExactAlarmGranted(granted)
                    })
                  }}
                  className="flex items-center gap-3 py-3 text-left transition-colors active:bg-muted/60"
                >
                  <AlarmClock className="size-5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">{t("permissions.exactAlarmTitle")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("permissions.exactAlarmDesc")}
                    </span>
                  </div>
                  {exactAlarmGranted !== null && (
                    <span
                      className={`text-xs ${exactAlarmGranted ? "text-green-600" : "text-orange-500"}`}
                    >
                      {exactAlarmGranted
                        ? t("permissions.exactAlarmGranted")
                        : t("permissions.exactAlarmNotGranted")}
                    </span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  void props.requestBatteryOptimizationExemption().then((ignored) => {
                    setBatteryIgnored(ignored)
                  })
                }}
                className={`flex items-center gap-3 py-3 text-left transition-colors active:bg-muted/60 ${props.requestExactAlarmPermission ? "border-t border-border" : ""}`}
              >
                <Battery className="size-5 shrink-0 translate-x-0.5 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("permissions.batteryTitle")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("permissions.batteryDesc")}
                  </span>
                </div>
                {batteryIgnored !== null && (
                  <span
                    className={`text-xs ${batteryIgnored ? "text-green-600" : "text-orange-500"}`}
                  >
                    {batteryIgnored
                      ? t("permissions.batteryIgnored")
                      : t("permissions.batteryNotIgnored")}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={() => setAutoStartDialogOpen(true)}
                className="flex items-center gap-3 border-t border-border py-3 text-left transition-colors active:bg-muted/60"
              >
                <ShieldCheck className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("permissions.autoStartTitle")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("permissions.autoStartDesc")}
                  </span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </>
          )}

          {hasPollingSettings && (
            <>
              <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
                {t("polling.sectionTitle")}
              </h3>

              <div className="flex items-center gap-3 py-3">
                <Bell className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-1 flex-col">
                  <span className="text-sm">{t("polling.enabledTitle")}</span>
                  <span className="text-xs text-muted-foreground">{t("polling.enabledDesc")}</span>
                </div>
                <Switch
                  aria-label={t("polling.enabledTitle")}
                  checked={enabled}
                  disabled={permissionPending}
                  onCheckedChange={(checked) => void handleToggle(checked)}
                />
              </div>

              {enabled && (
                <SettingNumberInput
                  icon={Timer}
                  label={t("polling.intervalTitle")}
                  description={t("polling.intervalHint")}
                  value={checkInterval}
                  onChange={actions.setCheckInterval}
                  min={15}
                  max={1440}
                  unit={t("polling.intervalUnit")}
                  bordered
                />
              )}

              {enabled && (pollingChannelIds.length > 0 || hasContentSlotItems) && (
                <div className="flex items-center gap-3 border-t border-border py-3">
                  <CalendarClock className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm">{t("polling.contentTitle")}</span>
                  <ToggleGroup
                    type="multiple"
                    value={enabledPollingChannelIds}
                    onValueChange={(nextIds) => {
                      actions.setEnabledChannels(nextIds, pollingChannelIds)
                    }}
                    variant="outline"
                    size="sm"
                  >
                    {renderSlot("settings.notifications.content")}
                  </ToggleGroup>
                </div>
              )}

              {enabled && (
                <div className="flex items-center gap-3 border-t border-border py-3">
                  <WifiOff className="size-5 shrink-0 text-muted-foreground" />
                  <div className="flex flex-1 flex-col">
                    <span className="text-sm">{t("polling.networkErrorTitle")}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("polling.networkErrorDesc")}
                    </span>
                  </div>
                  <Switch
                    aria-label={t("polling.networkErrorTitle")}
                    checked={notifyNetworkError}
                    onCheckedChange={actions.setNotifyNetworkError}
                  />
                </div>
              )}
            </>
          )}

          {native && renderSlot("settings.notifications.reminders")}
          {renderSlot("settings.notifications.appReminders")}
        </CardContent>
      </Card>

      <Dialog open={autoStartDialogOpen} onOpenChange={setAutoStartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("permissions.autoStartDialogTitle")}</DialogTitle>
            <DialogDescription>{t("permissions.autoStartDialogContent")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setAutoStartDialogOpen(false)}>{t("permissions.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
