"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { ChevronRight, CircleAlert, Flag, History, MapPin, Route } from "lucide-react"
import { Badge } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@orahako/plugin-ui/components"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@orahako/plugin-ui/components"
import { Skeleton } from "@orahako/plugin-ui/components"
import { Spinner } from "@orahako/plugin-ui/components"
import { PerlicaRouteMap } from "./perlica-route-map"
import type { PerlicaClient } from "../extras/client"
import type {
  PerlicaCoords,
  PerlicaParkPoint,
  PerlicaRaw,
  PerlicaRideDetail,
  PerlicaRideLog,
} from "../extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"

export interface PerlicaHistoryProps {
  client: PerlicaClient
  coords: PerlicaCoords
  logs: PerlicaRideLog[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  reportError: (error: unknown) => void
}

function cleanText(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return ""
  const text = String(value).trim()
  if (!text || /https?:\/\/|TOKEN:/i.test(text)) return ""
  return text
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(value)
    if (text) return text
  }
  return ""
}

function validPoint(lat: number, lng: number): PerlicaCoords | null {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null
  }
  return { lat, lng }
}

function startName(detail: PerlicaRideDetail): string {
  const raw = detail.raw
  return firstText(
    detail.startAddress,
    raw.startStationName,
    raw.startStation,
    raw.startName,
    raw.startPointName,
    raw.startParkName,
    raw.borrowStationName,
    raw.borrowPointName,
    raw.borrowName
  )
}

function endName(detail: PerlicaRideDetail): string {
  const raw = detail.raw
  return firstText(
    detail.endAddress,
    raw.endStationName,
    raw.endStation,
    raw.endName,
    raw.endPointName,
    raw.endParkName,
    raw.returnStationName,
    raw.returnPointName,
    raw.returnName
  )
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

function recoverStartPoint(points: PerlicaParkPoint[], name: string) {
  const target = normalizeName(name)
  if (!target) return null
  const match = points.find(
    (point) => normalizeName(point.name) === target || normalizeName(point.address) === target
  )
  return match ? validPoint(match.lat, match.lng) : null
}

function cardDeduction(raw: PerlicaRaw): number | null {
  for (const key of [
    "cardDeductionMoney",
    "rideCardDeductionMoney",
    "giftCardDeductionMoney",
    "rideDiscountActivityMoney",
  ]) {
    const value = Number(raw[key])
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium break-words">{children}</dd>
    </div>
  )
}

export function PerlicaHistory({
  client,
  coords,
  logs,
  loading,
  hasMore,
  onLoadMore,
  reportError,
}: PerlicaHistoryProps) {
  const { t, locale } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const requestRef = useRef(0)
  const [selected, setSelected] = useState<PerlicaRideLog | null>(null)
  const [detail, setDetail] = useState<PerlicaRideDetail | null>(null)
  const [recoveredStart, setRecoveredStart] = useState<PerlicaCoords | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailFailed, setDetailFailed] = useState(false)

  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale]
  )
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "CNY",
        minimumFractionDigits: 2,
      }),
    [locale]
  )

  useEffect(
    () => () => {
      requestRef.current += 1
    },
    []
  )

  const closeDetail = useCallback(() => {
    requestRef.current += 1
    setSelected(null)
    setDetail(null)
    setRecoveredStart(null)
    setDetailLoading(false)
    setDetailFailed(false)
  }, [])

  const openDetail = useCallback(
    async (log: PerlicaRideLog) => {
      const requestId = ++requestRef.current
      setSelected(log)
      setDetail(null)
      setRecoveredStart(null)
      setDetailFailed(false)
      setDetailLoading(true)

      if (!log.orderNo) {
        setDetailLoading(false)
        setDetailFailed(true)
        return
      }

      try {
        let nextDetail = await client.rideDetail(log.orderNo)
        if (requestRef.current !== requestId) return

        try {
          const route = await client.rideRoute(nextDetail)
          if (requestRef.current !== requestId) return
          nextDetail = { ...nextDetail, route }
        } catch (error) {
          if (requestRef.current !== requestId) return
          // Start/end markers remain useful when the optional track is unavailable.
          reportError(error)
        }

        let nextRecoveredStart: PerlicaCoords | null = null
        const nextStartName = startName(nextDetail)
        if (!validPoint(nextDetail.startLat, nextDetail.startLng) && nextStartName) {
          try {
            const points = await client.parkPoints(coords)
            if (requestRef.current !== requestId) return
            nextRecoveredStart = recoverStartPoint(points, nextStartName)
          } catch (error) {
            if (requestRef.current !== requestId) return
            reportError(error)
          }
        }

        if (requestRef.current !== requestId) return
        setRecoveredStart(nextRecoveredStart)
        setDetail(nextDetail)
      } catch (error) {
        if (requestRef.current !== requestId) return
        setDetailFailed(true)
        reportError(error)
      } finally {
        if (requestRef.current === requestId) setDetailLoading(false)
      }
    },
    [client, coords, reportError]
  )

  const formatFee = (fee: number) =>
    Number.isFinite(fee) ? currencyFormatter.format(fee) : t("perlica.historyUnknown")

  const formatStatus = (ride: PerlicaRideLog) => {
    if (ride.status === "paid") return t("perlica.historyStatusPaid")
    if (ride.status === "unpaid") return t("perlica.historyStatusUnpaid")
    return ride.status || t("perlica.historyUnknown")
  }

  const formatDistance = (distance: number) => {
    if (!Number.isFinite(distance) || distance < 0) return t("perlica.historyUnknown")
    if (distance >= 1000) {
      return t("perlica.historyDistanceKilometers", {
        value: numberFormatter.format(distance / 1000),
      })
    }
    return t("perlica.historyDistanceMeters", { value: numberFormatter.format(distance) })
  }

  const formatDuration = (duration: number) => {
    if (!Number.isFinite(duration) || duration < 0) return t("perlica.historyUnknown")
    const totalSeconds = Math.floor(duration)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (hours > 0) {
      return `${t("perlica.historyDurationHours", { value: hours })} ${t(
        "perlica.historyDurationMinutes",
        { value: minutes }
      )}`
    }
    if (minutes > 0) {
      const minuteText = t("perlica.historyDurationMinutes", { value: minutes })
      return seconds > 0
        ? `${minuteText} ${t("perlica.historyDurationSeconds", { value: seconds })}`
        : minuteText
    }
    return t("perlica.historyDurationSeconds", { value: seconds })
  }

  const detailStartName = detail ? startName(detail) : ""
  const detailEndName = detail ? endName(detail) : ""
  const start = useMemo(
    () => (detail ? validPoint(detail.startLat, detail.startLng) : null),
    [detail]
  )
  const end = useMemo(() => (detail ? validPoint(detail.endLat, detail.endLng) : null), [detail])
  const deduction = detail ? cardDeduction(detail.raw) : null

  return (
    <>
      <section className="space-y-4">
        <div className="px-1">
          <h2 className="text-lg font-semibold">{t("perlica.historyTitle")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("perlica.historyDescription")}</p>
        </div>
        <div aria-busy={loading}>
          {loading && logs.length === 0 ? (
            <div className="space-y-3" aria-label={t("perlica.historyLoading")}>
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-36 w-full rounded-2xl" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <Empty className="min-h-[45dvh] py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon" className="size-14 rounded-2xl">
                  <History />
                </EmptyMedia>
                <EmptyTitle>{t("perlica.historyEmptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("perlica.historyEmptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="space-y-3">
              {logs.map((log, index) => (
                <li key={`${log.orderNo || "ride"}-${index}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2 rounded-2xl bg-card p-4 text-left whitespace-normal ring-1 ring-foreground/10 transition hover:bg-card/80 active:scale-[0.99]"
                    onClick={() => void openDetail(log)}
                    aria-label={t("perlica.historyOpenDetail", {
                      time: log.startTime || t("perlica.historyUnknown"),
                    })}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {log.startTime || t("perlica.historyUnknown")}
                        </span>
                        <Badge variant="secondary">{formatStatus(log)}</Badge>
                      </span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {t("perlica.historyVehicle")} ·{" "}
                        {log.userCode || t("perlica.historyUnknown")}
                      </span>
                      <span className="mt-4 grid grid-cols-3 gap-2">
                        <span>
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {t("perlica.historyDuration")}
                          </span>
                          <span className="mt-1 block text-sm font-medium">
                            {formatDuration(log.duration)}
                          </span>
                        </span>
                        <span>
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {t("perlica.historyDistance")}
                          </span>
                          <span className="mt-1 block text-sm font-medium">
                            {formatDistance(log.distance)}
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {t("perlica.historyFee")}
                          </span>
                          <span className="mt-1 block text-sm font-semibold">
                            {formatFee(log.fee)}
                          </span>
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasMore ? (
          <div className="flex justify-center pt-1">
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-xl"
              onClick={onLoadMore}
              disabled={loading}
            >
              {loading ? <Spinner /> : null}
              {loading ? t("perlica.historyLoading") : t("perlica.historyLoadMore")}
            </Button>
          </div>
        ) : logs.length > 0 ? (
          <p className="pt-2 text-center text-xs text-muted-foreground">
            {t("perlica.historyEnd")}
          </p>
        ) : null}
      </section>

      <ResponsiveModal open={selected !== null} onOpenChange={(open) => !open && closeDetail()}>
        <ResponsiveModalContent
          className="flex max-h-[90vh] flex-col sm:max-w-2xl"
          drawerClassName="gap-0"
        >
          <ResponsiveModalHeader className="text-left">
            <ResponsiveModalTitle>{t("perlica.historyDetailTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {t("perlica.historyDetailDescription")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <ResponsiveModalBody className="min-h-0 flex-1 overflow-y-auto" data-vaul-no-drag>
            {detailLoading ? (
              <div className="space-y-4 py-2" role="status">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner />
                  {t("perlica.historyLoading")}
                </span>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-[280px] w-full" />
              </div>
            ) : detailFailed ? (
              <Empty className="border-0 py-8">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CircleAlert />
                  </EmptyMedia>
                  <EmptyTitle>{t("perlica.historyDetailLoadFailed")}</EmptyTitle>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => selected && void openDetail(selected)}
                  >
                    {t("perlica.historyRetry")}
                  </Button>
                </EmptyHeader>
              </Empty>
            ) : detail ? (
              <div className="space-y-5 pb-2">
                <section className="space-y-2" aria-label={t("perlica.historyRoute")}>
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <Route className="size-4" />
                    {t("perlica.historyRoute")}
                  </h3>
                  <PerlicaRouteMap
                    route={detail.route}
                    start={start ?? recoveredStart}
                    end={end}
                    startName={detailStartName || undefined}
                    endName={detailEndName || undefined}
                  />
                </section>

                <dl className="grid grid-cols-2 gap-x-3 rounded-2xl bg-muted/50 px-3 py-2 sm:grid-cols-4">
                  <DetailRow label={t("perlica.historyFee")}>{formatFee(detail.fee)}</DetailRow>
                  <DetailRow label={t("perlica.historyDistance")}>
                    {formatDistance(detail.distance)}
                  </DetailRow>
                  <DetailRow label={t("perlica.historyDuration")}>
                    {formatDuration(detail.duration)}
                  </DetailRow>
                  <DetailRow label={t("perlica.historyStatus")}>{formatStatus(detail)}</DetailRow>
                </dl>

                {deduction !== null ? (
                  <dl className="rounded-xl border px-3">
                    <DetailRow label={t("perlica.historyCardDeduction")}>
                      {formatFee(deduction / 100)}
                    </DetailRow>
                  </dl>
                ) : null}

                <ol className="relative space-y-5 before:absolute before:top-5 before:bottom-5 before:left-[7px] before:w-px before:bg-border">
                  <li className="relative flex items-start gap-3">
                    <span className="z-10 mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-background">
                      <MapPin className="size-4 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <h4 className="text-sm font-medium">{t("perlica.historyStartAddress")}</h4>
                        <time className="text-xs text-muted-foreground">
                          {detail.startTime || t("perlica.historyUnknown")}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {detailStartName || t("perlica.historyUnknown")}
                      </p>
                    </div>
                  </li>
                  <li className="relative flex items-start gap-3">
                    <span className="z-10 mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-background">
                      <Flag className="size-4 text-destructive" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <h4 className="text-sm font-medium">{t("perlica.historyEndAddress")}</h4>
                        <time className="text-xs text-muted-foreground">
                          {detail.endTime || t("perlica.historyUnknown")}
                        </time>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {detailEndName || t("perlica.historyUnknown")}
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            ) : null}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  )
}
