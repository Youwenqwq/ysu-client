import { useEffect, useState } from "react"
import { Bell, Play, Power, RefreshCw, Shield, Trash2 } from "lucide-react"
import type { AcademicNotificationChannel, ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ScrollArea,
} from "@orahako/ui-primitives"
import { evaluateNotificationChannels } from "./controller"
import type { NotificationSettingsStoreInstance, NotificationsDictionary } from "./store"

export interface NotificationDebugInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly channels: ObservableSource<readonly AcademicNotificationChannel[]>
  }
  readonly isNative: () => boolean
  readonly checkPermission: () => Promise<boolean>
  readonly requestPermission: () => Promise<boolean>
  readonly startPolling: () => Promise<void>
  readonly stopPolling: () => Promise<void>
  readonly checkNow: () => Promise<void>
  readonly inspectPolling: () => Promise<Record<string, unknown> | null>
}

export type NotificationDebugPanelProps = DerivedComponentProps<
  Record<string, never>,
  NotificationsDictionary,
  undefined,
  NotificationSettingsStoreInstance,
  NotificationDebugInject
>

function renderStatusBadge(value: boolean | null) {
  if (value === true) {
    return (
      <Badge variant="default" className="text-[10px]">
        OK
      </Badge>
    )
  }
  if (value === false) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        OFF
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[10px]">
      N/A
    </Badge>
  )
}

export const NotificationDebugPanel: SlotComponent<NotificationDebugPanelProps> = (props) => {
  const { t, useStore } = props
  const providerSnap = props.useProvider()
  const channels = props.useChannels()

  const enabled = useStore((s) => s.enabled)
  const checkInterval = useStore((s) => s.checkInterval)
  const notifyNetworkError = useStore((s) => s.notifyNetworkError)
  const disabledChannels = useStore((s) => s.disabledChannels)

  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null)
  const [inspectState, setInspectState] = useState<Record<string, unknown> | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  const plan = evaluateNotificationChannels(channels, providerSnap.provider, disabledChannels)
  const activeChannelIds = plan.channels
    .filter((entry) => entry.active)
    .map((entry) => entry.channel.id)
  const flagSummary = Object.entries(plan.flags)
    .map(([key, val]) => `${key}=${String(val)}`)
    .join(", ")

  const appendLog = (message: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`])
  }

  const { isNative, inspectPolling } = props
  useEffect(() => {
    if (!isNative()) return
    void inspectPolling()
      .then((state) => {
        setInspectState(state)
      })
      .catch(() => {})
  }, [isNative, inspectPolling])

  async function runNativeAction(name: string, fn: () => Promise<void>) {
    if (!props.isNative()) {
      appendLog(t("debug.nativeOnly"))
      return
    }
    try {
      await fn()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendLog(`${name}: ${msg}`)
    }
  }

  return (
    <Card data-notification-debug="">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bell className="size-4" />
          {t("debug.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("debug.enabled")}</span>
          {renderStatusBadge(enabled)}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("debug.interval")}</span>
          <span className="font-mono text-xs">
            {t("debug.intervalMinutes", { minutes: checkInterval })}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("debug.networkError")}</span>
          {renderStatusBadge(notifyNetworkError)}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("debug.permission")}</span>
          {renderStatusBadge(permissionGranted)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("debug.channels")}</span>
          <span className="font-mono text-xs">
            {activeChannelIds.length > 0 ? activeChannelIds.join(", ") : t("debug.none")}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t("debug.flags")}</span>
          <span className="font-mono text-xs">{flagSummary || t("debug.none")}</span>
        </div>
        {inspectState && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("debug.nativeState")}</span>
            <pre className="overflow-x-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
              {JSON.stringify(inspectState, null, 2)}
            </pre>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("checkPermission", async () => {
                const granted = await props.checkPermission()
                setPermissionGranted(granted)
                appendLog(`checkPermissions=${String(granted)}`)
              })
            }
          >
            <Shield className="mr-1 size-3.5" />
            {t("debug.checkPermission")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("requestPermission", async () => {
                const granted = await props.requestPermission()
                setPermissionGranted(granted)
                appendLog(`requestPermissions=${String(granted)}`)
              })
            }
          >
            <Shield className="mr-1 size-3.5" />
            {t("debug.requestPermission")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("startPolling", async () => {
                await props.startPolling()
                appendLog("polling started")
                setInspectState(await props.inspectPolling())
              })
            }
          >
            <Play className="mr-1 size-3.5" />
            {t("debug.startPolling")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("stopPolling", async () => {
                await props.stopPolling()
                appendLog("polling stopped")
                setInspectState(await props.inspectPolling())
              })
            }
          >
            <Power className="mr-1 size-3.5" />
            {t("debug.stopPolling")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("checkNow", async () => {
                await props.checkNow()
                appendLog("polling checkNow triggered")
              })
            }
          >
            <RefreshCw className="mr-1 size-3.5" />
            {t("debug.checkNow")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void runNativeAction("inspect", async () => {
                const state = await props.inspectPolling()
                setInspectState(state)
                appendLog("inspect refreshed")
              })
            }
          >
            <RefreshCw className="mr-1 size-3.5" />
            {t("debug.refreshInspect")}
          </Button>
        </div>

        {logs.length > 0 && (
          <div className="flex flex-col gap-1 pt-1">
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
                <Trash2 className="mr-1 size-3.5" />
                {t("debug.clearLog")}
              </Button>
            </div>
            <ScrollArea className="h-24 rounded-md border bg-muted/30 p-2">
              <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
                {logs.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
