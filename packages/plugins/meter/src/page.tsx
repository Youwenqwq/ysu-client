import { useEffect, useRef, useState } from "react"
import { AirVent, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"
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
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Input,
  Separator,
  Skeleton,
} from "@orahako/ui-primitives"
import type { MeterDictionary } from "./dictionary"
import type {
  MeterQueryFailure,
  MeterQuerySnapshot,
  MeterRoomStoreInstance,
  SessionAccountSnapshot,
} from "./store"

export interface MeterPageInject {
  readonly hooks: {
    readonly storeHydrated: ObservableSource<boolean>
    readonly session: ObservableSource<SessionAccountSnapshot>
    readonly meter: ObservableSource<MeterQuerySnapshot>
  }
  readonly queryAccount: (account: string) => Promise<void>
  readonly refresh: () => Promise<void>
}

export type MeterPageProps = DerivedComponentProps<
  Record<string, never>,
  MeterDictionary,
  undefined,
  MeterRoomStoreInstance,
  MeterPageInject
>

function formatFailure(failure: MeterQueryFailure, t: Translator<MeterDictionary>): string {
  if (failure.kind === "not_bound") {
    return t("meter.notBound")
  }
  return t("meter.loadFailed", { message: failure.message })
}

export const MeterPage: SlotComponent<MeterPageProps> = (props) => {
  const { t, useStore, actions, queryAccount, refresh } = props
  const storeHydrated = props.useStoreHydrated()
  const session = props.useSession()
  const meterState = props.useMeter()

  const selectedAccount = useStore((s) => s.selectedAccount)
  const history = useStore((s) => s.history)
  const effectiveAccount = selectedAccount.trim() || session.username?.trim() || ""

  const [draftAccount, setDraftAccount] = useState<string>(effectiveAccount)
  const prevEffectiveRef = useRef<string>(effectiveAccount)
  const lastToastSeqRef = useRef<number>(0)

  useEffect(() => {
    if (prevEffectiveRef.current !== effectiveAccount) {
      prevEffectiveRef.current = effectiveAccount
      setDraftAccount(effectiveAccount)
    }
  }, [effectiveAccount])

  useEffect(() => {
    if (meterState.refreshError && meterState.refreshErrorSeq > lastToastSeqRef.current) {
      lastToastSeqRef.current = meterState.refreshErrorSeq
      toast.error(formatFailure(meterState.refreshError, t))
    }
  }, [meterState.refreshError, meterState.refreshErrorSeq, t])

  const handleSearch = (): void => {
    const trimmed = draftAccount.trim()
    if (!trimmed) return
    void queryAccount(trimmed)
  }

  const data = meterState.data
  const loading = meterState.isLoading
  const updatedAt = meterState.updatedAt !== null ? new Date(meterState.updatedAt) : null
  const errorText = meterState.error ? formatFailure(meterState.error, t) : null

  const selectorBar = (
    <Card size="sm" data-meter-account-bar="">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            name="meter-account"
            value={draftAccount}
            onChange={(event) => setDraftAccount(event.target.value)}
            placeholder={t("meter.accountPlaceholder")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSearch()
              }
            }}
          />
          <Button
            type="button"
            onClick={handleSearch}
            disabled={loading || draftAccount.trim().length === 0}
          >
            <Search data-icon="inline-start" className="size-4" />
            {t("meter.queryButton")}
          </Button>
          {effectiveAccount ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void refresh()}
              disabled={loading}
              aria-label={t("meter.refresh")}
            >
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          ) : null}
        </div>

        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-meter-history="">
            <span className="text-xs text-muted-foreground">{t("meter.historyLabel")}:</span>
            {history.map((item) => {
              const isActive = item.account === effectiveAccount
              const displayLabel = item.roomFullName || item.account
              return (
                <span
                  key={item.account}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDraftAccount(item.account)
                      void queryAccount(item.account)
                    }}
                    className="max-w-48 truncate"
                  >
                    {displayLabel}
                  </button>
                  <button
                    type="button"
                    aria-label={t("meter.removeHistory", { name: displayLabel })}
                    onClick={() => actions.removeRoom(item.account)}
                    className="rounded-full p-0.5 opacity-75 hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (!storeHydrated || (!effectiveAccount && !session.hasHydrated)) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {selectorBar}
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (!effectiveAccount) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {selectorBar}
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AirVent />
            </EmptyMedia>
            <EmptyTitle>{t("meter.noAccount")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (!data && loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {selectorBar}
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {selectorBar}
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AirVent />
            </EmptyMedia>
            <EmptyTitle>{errorText ?? t("meter.notBound")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            {t("meter.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  const meters = data.overview?.meters ?? []
  const daily = data.daily
  const maxDaily = Math.max(0, ...daily.map((d) => d.use))
  const activeDays = daily.filter((d) => d.use > 0)
  const avgDaily = activeDays.length
    ? activeDays.reduce((sum, d) => sum + d.use, 0) / activeDays.length
    : 0
  const today = daily[daily.length - 1]?.date

  if (meters.length === 0) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {selectorBar}
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AirVent />
            </EmptyMedia>
            <EmptyTitle>{t("meter.notBound")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-meter-page="">
      {selectorBar}

      {updatedAt ? (
        <div className="flex items-center justify-end">
          <span className="text-xs text-muted-foreground">
            {t("meter.updatedAt", {
              time: updatedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
        </div>
      ) : null}

      {meters.map((meter, mi) => {
        const currentMonth = meter.monthUse[meter.monthUse.length - 1]
        const estDays = avgDaily > 0 ? Math.floor(meter.remaining / avgDaily) : null
        return (
          <Card key={`${meter.deviceName}-${mi}`}>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AirVent className="size-4 shrink-0" />
                <span className="truncate">
                  {data.overview?.roomFullName || data.room.roomFullName}
                </span>
                {meter.lineDesc ? (
                  <Badge variant="outline" className="ml-auto shrink-0">
                    {meter.lineDesc}
                  </Badge>
                ) : null}
              </div>

              <div className="flex items-end gap-2">
                <span className="text-5xl leading-none font-bold tracking-tight tabular-nums">
                  {meter.remaining}
                </span>
                <span className="pb-0.5 text-lg text-muted-foreground">{t("meter.unit")}</span>
                <span className="ml-auto pb-0.5 text-sm text-muted-foreground">
                  {t("meter.balanceApprox", {
                    amount: (meter.remaining * meter.price).toFixed(2),
                  })}
                  {" · "}
                  {t("meter.priceLabel")} {meter.price}
                </span>
              </div>

              <Separator />

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="flex flex-col gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">{meter.todayUse}</span>
                  <span className="text-xs text-muted-foreground">{t("meter.todayUse")}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">
                    {currentMonth ? currentMonth.use : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("meter.monthUse")}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-lg font-semibold tabular-nums">
                    {estDays !== null ? estDays : "—"}
                  </span>
                  <span className="text-xs text-muted-foreground">{t("meter.estDaysLabel")}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("meter.trendTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("meter.trendEmpty")}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex h-28 items-end gap-[3px]">
                {daily.map((d) => (
                  <div
                    key={d.date}
                    title={t("meter.dayUseTooltip", {
                      date: d.date.slice(5),
                      use: String(d.use),
                    })}
                    className={cn(
                      "min-w-1 flex-1 rounded-sm transition-colors",
                      d.date === today ? "bg-primary" : "bg-primary/25 hover:bg-primary/50"
                    )}
                    style={{
                      height: `${maxDaily > 0 ? Math.max(3, (d.use / maxDaily) * 100) : 3}%`,
                    }}
                  />
                ))}
              </div>
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{daily[0]?.date.slice(5)}</span>
                <span>{today?.slice(5)}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("meter.rechargeTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recharges.length === 0 ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {t("meter.rechargeEmpty")}
            </p>
          ) : (
            <div className="flex flex-col">
              {data.recharges.map((r, i) => (
                <div key={`${r.time}-${i}`}>
                  {i > 0 ? <Separator /> : null}
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{r.time}</span>
                    </div>
                    <div className="ml-auto flex shrink-0 items-baseline gap-2">
                      <span className="font-semibold text-primary tabular-nums">
                        +{r.amount} {t("meter.unit")}
                      </span>
                      {r.fare > 0 ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          ¥{r.fare}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
