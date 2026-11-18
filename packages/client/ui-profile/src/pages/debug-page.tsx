import { useState } from "react"
import { Bug, RefreshCw } from "lucide-react"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  NativeCapabilityDescriptor,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import "../slots-declare"
import type { ProfileDictionary } from "../dictionary"

export const debugPageChildren = {
  "debug.panels": { kind: "list" },
} as const

export interface RuntimeDiagnosticsSnapshot {
  readonly isNative: boolean
  readonly screen: string
  readonly viewport: string
  readonly userAgent: string
  readonly nativeCapabilities: readonly NativeCapabilityDescriptor[]
}

export interface DebugPageInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
  }
  readonly collectDiagnostics: () => RuntimeDiagnosticsSnapshot
}

export type DebugPageProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  typeof debugPageChildren,
  undefined,
  DebugPageInject
>

export const DebugPage: SlotComponent<DebugPageProps> = (props) => {
  const { t, renderSlot } = props
  const location = props.useLocation()
  const [refreshTick, setRefreshTick] = useState(0)
  void refreshTick

  const diag = props.collectDiagnostics()
  const extraPanels = renderSlot("debug.panels")

  return (
    <div className="flex flex-col gap-4" data-page="debug">
      <div className="flex items-center gap-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Bug className="size-5" />
          {t("debug.title")}
        </h1>
        <div className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRefreshTick((value) => value + 1)}
        >
          <RefreshCw className="size-3.5" />
          {t("debug.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("debug.platform")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("debug.platformType")}</span>
            <Badge variant={diag.isNative ? "default" : "secondary"} className="text-[10px]">
              {diag.isNative ? t("debug.platformNative") : t("debug.platformWeb")}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("debug.platformScreen")}</span>
            <span className="font-mono text-xs">{diag.screen}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t("debug.platformViewport")}</span>
            <span className="font-mono text-xs">{diag.viewport}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="shrink-0 text-muted-foreground">{t("debug.platformRoute")}</span>
            <span className="truncate font-mono text-xs">{location.href}</span>
          </div>
          <div className="flex flex-col gap-0.5 pt-1">
            <span className="text-muted-foreground">{t("debug.platformUserAgent")}</span>
            <span className="font-mono text-[10px] break-all text-muted-foreground">
              {diag.userAgent}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {t("debug.nativeCapabilities")} ({diag.nativeCapabilities.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 text-sm">
          {diag.nativeCapabilities.length === 0 ? (
            <span className="text-xs text-muted-foreground">{t("debug.noNativeCapabilities")}</span>
          ) : (
            <ul className="flex flex-col gap-1">
              {diag.nativeCapabilities.map((cap) => (
                <li
                  key={`${cap.id}@${cap.version}`}
                  className="flex items-center justify-between font-mono text-xs"
                >
                  <span>
                    {cap.id}@{cap.version}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {cap.methods.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {extraPanels}
    </div>
  )
}
