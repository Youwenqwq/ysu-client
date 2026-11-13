"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  ChevronRight,
  CircleAlert,
  Clock3,
  Flag,
  History,
  MapPin,
  RefreshCw,
  Route,
} from "lucide-react"
import { Badge } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
  onRefresh: () => void
  reportError: (error: unknown) => void
}

type DeductionValue = string | number | boolean

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

function isCardDeductionKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (normalized.includes("card") && /deduct|discount|fee|amount|money/.test(normalized)) {
    return true
  }
  return /^(?:ride)?(?:deduct|deduction|discount)(?:fee|amount|money)?$/.test(normalized)
}

function cardDeductions(raw: PerlicaRaw): Array<[string, DeductionValue]> {
  return Object.entries(raw).filter((entry): entry is [string, DeductionValue] => {
    const [key, value] = entry
    if (!isCardDeductionKey(key)) return false
    if (typeof value === "number") return Number.isFinite(value)
    if (typeof value === "boolean") return true
    return typeof value === "string" && cleanText(value) !== ""
  })
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
  onRefresh,
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
        const nextDetail = await client.rideDetail(log.orderNo)
        if (requestRef.current !== requestId) return

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

  const formatDeduction = (value: DeductionValue) => {
    if (typeof value === "number") return formatFee(value)
    if (typeof value === "boolean") {
      return value ? t("perlica.historyYes") : t("perlica.historyNo")
    }
    const numericValue = Number(value)
    return value.trim() !== "" && Number.isFinite(numericValue)
      ? currencyFormatter.format(numericValue)
      : value
  }

  const detailStartName = detail ? startName(detail) : ""
  const detailEndName = detail ? endName(detail) : ""
  const start = useMemo(
    () => (detail ? validPoint(detail.startLat, detail.startLng) : null),
    [detail]
  )
  const end = useMemo(() => (detail ? validPoint(detail.endLat, detail.endLng) : null), [detail])
  const deductions = useMemo(() => (detail ? cardDeductions(detail.raw) : []), [detail])

  return (
    <>
      <section className="flex flex-col">
        <header className="flex items-start justify-between gap-4 pb-6">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t("perlica.historyTitle")}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t("perlica.historyDescription")}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
            {loading ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
            {t("perlica.historyRefresh")}
          </Button>
        </header>

        <div aria-busy={loading}>
          {loading && logs.length === 0 ? (
            <div className="space-y-2 border-t pt-4" aria-label={t("perlica.historyLoading")}>
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-20 w-full" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <Empty className="border-y px-3 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <History />
                </EmptyMedia>
                <EmptyTitle>{t("perlica.historyEmptyTitle")}</EmptyTitle>
                <EmptyDescription>{t("perlica.historyEmptyDescription")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="divide-y border-y">
              {logs.map((log, index) => (
                <li key={`${log.orderNo || "ride"}-${index}`}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-3 rounded-none px-2 py-4 text-left whitespace-normal hover:bg-muted/40"
                    onClick={() => void openDetail(log)}
                    aria-label={t("perlica.historyOpenDetail", {
                      time: log.startTime || t("perlica.historyUnknown"),
                    })}
                  >
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {log.startTime || t("perlica.historyUnknown")}
                        </span>
                        <Badge variant="secondary">
                          {log.status || t("perlica.historyUnknown")}
                        </Badge>
                      </span>
                      <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-normal text-muted-foreground">
                        <span>
                          {t("perlica.historyVehicle")}:{" "}
                          {log.machineNo || log.userCode || t("perlica.historyUnknown")}
                        </span>
                        <span>{formatDuration(log.duration)}</span>
                        <span>{formatDistance(log.distance)}</span>
                        <span className="font-medium text-foreground">{formatFee(log.fee)}</span>
                      </span>
                    </span>
                    <ChevronRight className="self-center text-muted-foreground" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {hasMore ? (
          <div className="flex justify-center pt-6">
            <Button type="button" variant="outline" onClick={onLoadMore} disabled={loading}>
              {loading ? <Spinner /> : null}
              {loading ? t("perlica.historyLoading") : t("perlica.historyLoadMore")}
            </Button>
          </div>
        ) : logs.length > 0 ? (
          <p className="pt-6 text-center text-xs text-muted-foreground">
            {t("perlica.historyEnd")}
          </p>
        ) : null}
      </section>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("perlica.historyDetailTitle")}</DialogTitle>
            <DialogDescription>{t("perlica.historyDetailDescription")}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
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
              <div className="space-y-5 pb-1">
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DetailRow label={t("perlica.historyFee")}>{formatFee(detail.fee)}</DetailRow>
                  <DetailRow label={t("perlica.historyDistance")}>
                    {formatDistance(detail.distance)}
                  </DetailRow>
                  <DetailRow label={t("perlica.historyDuration")}>
                    {formatDuration(detail.duration)}
                  </DetailRow>
                  <DetailRow label={t("perlica.historyStatus")}>
                    {detail.status || t("perlica.historyUnknown")}
                  </DetailRow>
                </dl>

                {deductions.length > 0 ? (
                  <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {deductions.map(([key, value]) => (
                      <DetailRow key={key} label={t("perlica.historyCardDeduction")}>
                        {formatDeduction(value)}
                      </DetailRow>
                    ))}
                  </dl>
                ) : null}

                <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <DetailRow label={t("perlica.historyStartAddress")}>
                    <span className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>{detailStartName || t("perlica.historyUnknown")}</span>
                    </span>
                  </DetailRow>
                  <DetailRow label={t("perlica.historyEndAddress")}>
                    <span className="flex items-start gap-1.5">
                      <Flag className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>{detailEndName || t("perlica.historyUnknown")}</span>
                    </span>
                  </DetailRow>
                  <DetailRow label={t("perlica.historyStartTime")}>
                    <span className="flex items-start gap-1.5">
                      <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>{detail.startTime || t("perlica.historyUnknown")}</span>
                    </span>
                  </DetailRow>
                  <DetailRow label={t("perlica.historyEndTime")}>
                    <span className="flex items-start gap-1.5">
                      <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span>{detail.endTime || t("perlica.historyUnknown")}</span>
                    </span>
                  </DetailRow>
                </dl>

                <section className="space-y-2" aria-label={t("perlica.historyRoute")}>
                  <h3 className="flex items-center gap-1.5 text-sm font-medium">
                    <Route className="size-4" />
                    {t("perlica.historyRoute")}
                  </h3>
                  <PerlicaRouteMap
                    start={start ?? recoveredStart}
                    end={end}
                    startName={detailStartName || undefined}
                    endName={detailEndName || undefined}
                  />
                </section>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
