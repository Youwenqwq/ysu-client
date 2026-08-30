"use client"

import { useCallback, useEffect, useState } from "react"
import { AirVent, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useAuthStore } from "@/lib/stores/auth"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { fetchMeterData, MeterError, type MeterData } from "@/lib/extras/meter/client"
import { cn } from "@/lib/utils"

export default function MeterPage() {
  const { t } = useTranslation()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)

  const [data, setData] = useState<MeterData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (!username) return
    setLoading(true)
    try {
      const d = await fetchMeterData(username)
      setData(d)
      setError(null)
      setUpdatedAt(new Date())
    } catch (e) {
      const message =
        e instanceof MeterError && e.message === "NOT_BOUND"
          ? t("meter.notBound")
          : t("meter.loadFailed", {
              message: e instanceof Error ? e.message : String(e),
            })
      // 已有数据时刷新失败不顶掉旧数据
      if (data) toast.error(message)
      else setError(message)
    } finally {
      setLoading(false)
    }
  }, [username, data, t])

  useEffect(() => {
    if (hasHydrated && username) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在学号就绪时首拉
  }, [hasHydrated, username])

  // 移动端刷新按钮入顶栏（与成绩/日程页同一模式）；桌面端用页内按钮
  useMobileHeaderRight(
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void load()}
      disabled={loading}
      aria-label={t("meter.refresh")}
    >
      <RefreshCw className={cn("size-4", loading && "animate-spin")} />
    </Button>,
    [loading, load, t]
  )

  if (hasHydrated && !username) {
    return (
      <div className="p-4">
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
      <div className="flex flex-col gap-4">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AirVent />
            </EmptyMedia>
            <EmptyTitle>{error}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void load()}>
            {t("meter.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  const meters = data.overview?.meters ?? []
  const daily = data.daily
  const maxDaily = Math.max(0, ...daily.map((d) => d.use))
  // 预计可用天数：近 30 天有用量记录的日均
  const activeDays = daily.filter((d) => d.use > 0)
  const avgDaily = activeDays.length
    ? activeDays.reduce((s, d) => s + d.use, 0) / activeDays.length
    : 0
  const today = daily[daily.length - 1]?.date

  if (meters.length === 0) {
    return (
      <div className="p-4">
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
    <div className="flex flex-col gap-4">
      {/* 桌面端刷新行（移动端刷新在顶栏） */}
      <div className="hidden items-center justify-end gap-3 sm:flex">
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            {t("meter.updatedAt", {
              time: updatedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t("meter.refresh")}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {t("meter.refresh")}
        </Button>
      </div>

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
