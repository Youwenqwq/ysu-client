"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bike, CheckCircle2, Clock3, MapPin, Pause, Play, RotateCcw } from "lucide-react"
import { toast } from "@orahako/plugin-sdk/host"
import { Badge } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import { Card, CardContent } from "@orahako/plugin-ui/components"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@orahako/plugin-ui/components"
import type { PerlicaClient } from "../extras/client"
import { PARK_POINT_SEARCH_RADIUS_METERS, selectParkingPoints } from "../extras/parking"
import type {
  PerlicaCoords,
  PerlicaDispatchCheck,
  PerlicaOrder,
  PerlicaParkPoint,
} from "../extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"

const VISIBLE_POLL_MS = 8_000
const RETURN_RECHECK_DELAY_MS = 450
const DISPATCH_TYPE = 1

type ActionKind = "park" | "continue" | "return-check" | "return"
type ActionStep = "location" | "check" | "submit" | "verify" | "refresh"

type ActionState = {
  id: number
  kind: ActionKind
  step: ActionStep
  orderKey: string
}

type ReturnCandidate = {
  orderKey: string
  orderNo: string
  userCode: string
  coords: PerlicaCoords
  fee: number | null
  parkPoints: PerlicaParkPoint[]
  parkPoint: PerlicaParkPoint | null
}

export interface PerlicaActiveRideProps {
  client: PerlicaClient
  order: PerlicaOrder
  onOrderChange: (order: PerlicaOrder | null) => void
  onRequestLocation: () => Promise<PerlicaCoords | null>
  reportError: (error: unknown) => void
}

function orderKey(order: PerlicaOrder): string {
  return `${order.orderNo}\u0000${order.userCode}\u0000${order.machineNo}`
}

function sameOrder(order: PerlicaOrder | null, candidate: ReturnCandidate): boolean {
  return (
    order !== null && order.orderNo === candidate.orderNo && order.userCode === candidate.userCode
  )
}

function startTimestamp(value: string): number | null {
  const normalized = value.trim()
  if (!normalized) return null

  const numeric = Number(normalized)
  if (Number.isFinite(numeric)) {
    return Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
  }

  const parsed = Date.parse(normalized.replace(" ", "T"))
  return Number.isFinite(parsed) ? parsed : null
}

function elapsedText(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":")
}

function booleanValue(value: unknown): boolean | null {
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return null
}

function parkedStatus(order: PerlicaOrder): boolean | null {
  const dedicatedKeys = [
    "isParked",
    "isPark",
    "parked",
    "parking",
    "parkStatus",
    "parkState",
    "pauseStatus",
    "temporaryPark",
    "tempPark",
  ]

  for (const key of dedicatedKeys) {
    const value = order.raw[key]
    const boolean = booleanValue(value)
    if (boolean !== null) return boolean
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase()
      if (/^(park|parked|parking|pause|paused|temporary_park|temp_park)$/.test(normalized)) {
        return true
      }
      if (/^(continue|continued|riding|unparked|resume|resumed)$/.test(normalized)) {
        return false
      }
      if (normalized.includes("临停") || normalized.includes("暂停")) return true
      if (normalized.includes("骑行") || normalized.includes("继续")) return false
    }
  }

  const status = (order.status || String(order.raw.orderStatus ?? order.raw.state ?? ""))
    .trim()
    .toLowerCase()
  if (!status) return null
  if (/^(park|parked|parking|pause|paused|temporary_park|temp_park)$/.test(status)) {
    return true
  }
  if (status.includes("临停") || status.includes("暂停")) return true
  return false
}

function fallbackDispatchFee(dispatch: PerlicaDispatchCheck): number | null {
  const optionFee = dispatch.options.find((option) => option.type === DISPATCH_TYPE)?.money
  if (optionFee !== undefined) return optionFee

  for (const key of ["dispatchFee", "fee", "dispatchPrice", "amount", "price", "money"]) {
    const raw = dispatch.raw[key]
    if (raw === null || raw === undefined || raw === "") continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value / 100
  }
  return null
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  window.setTimeout(resolve, ms)
  return promise
}

function actionMessage(action: ActionState | null, t: (key: string) => string): string | null {
  if (!action) return null
  if (action.step === "location") return t("perlica.activeRideLocating")
  if (action.step === "check") return t("perlica.activeRideCheckingReturn")
  if (action.step === "verify") return t("perlica.activeRideVerifyingReturn")
  if (action.step === "refresh") return t("perlica.activeRideRefreshingOrder")
  if (action.kind === "park") return t("perlica.activeRideParking")
  if (action.kind === "continue") return t("perlica.activeRideContinuing")
  return t("perlica.activeRideReturning")
}

export function PerlicaActiveRide({
  client,
  order,
  onOrderChange,
  onRequestLocation,
  reportError,
}: PerlicaActiveRideProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const [now, setNow] = useState(() => Date.now())
  const [action, setAction] = useState<ActionState | null>(null)
  const [returnCandidate, setReturnCandidate] = useState<ReturnCandidate | null>(null)
  const [parkedOverride, setParkedOverride] = useState<boolean | null>(null)

  const mountedRef = useRef(false)
  const orderRef = useRef(order)
  const onOrderChangeRef = useRef(onOrderChange)
  const onRequestLocationRef = useRef(onRequestLocation)
  const reportErrorRef = useRef(reportError)
  const orderRequestRef = useRef(0)
  const actionSequenceRef = useRef(0)
  const actionRef = useRef<ActionState | null>(null)

  useEffect(() => {
    orderRef.current = order
    onOrderChangeRef.current = onOrderChange
    onRequestLocationRef.current = onRequestLocation
    reportErrorRef.current = reportError
  }, [onOrderChange, onRequestLocation, order, reportError])

  const currentOrderKey = orderKey(order)
  const startedAt = useMemo(() => startTimestamp(order.startTime), [order.startTime])
  const elapsed = startedAt === null ? null : Math.max(0, now - startedAt)
  const rawParkedStatus = parkedStatus(order)
  const isParked = parkedOverride ?? rawParkedStatus ?? false
  const busy = action !== null
  const currentActionMessage = actionMessage(action, t)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      orderRequestRef.current += 1
      actionRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    orderRequestRef.current += 1
    actionRef.current = null
    setAction(null)
    setReturnCandidate(null)
    setParkedOverride(null)
  }, [currentOrderKey])

  useEffect(() => {
    if (rawParkedStatus !== null) setParkedOverride(null)
  }, [order, rawParkedStatus])

  const refreshOrder = useCallback(
    async (expectedOrderKey: string) => {
      if (
        !mountedRef.current ||
        actionRef.current !== null ||
        orderKey(orderRef.current) !== expectedOrderKey
      ) {
        return
      }

      const requestId = ++orderRequestRef.current
      try {
        const nextOrder = await client.currentOrder()
        if (
          !mountedRef.current ||
          requestId !== orderRequestRef.current ||
          actionRef.current !== null ||
          orderKey(orderRef.current) !== expectedOrderKey
        ) {
          return
        }
        onOrderChangeRef.current(nextOrder)
      } catch (error) {
        if (
          mountedRef.current &&
          requestId === orderRequestRef.current &&
          actionRef.current === null &&
          orderKey(orderRef.current) === expectedOrderKey
        ) {
          reportErrorRef.current(error)
        }
      }
    },
    [client]
  )

  useEffect(() => {
    let timer: number | null = null
    let disposed = false

    const clearPoll = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = null
    }

    const schedule = () => {
      clearPoll()
      if (disposed || document.hidden) return
      timer = window.setTimeout(runPoll, VISIBLE_POLL_MS)
    }

    const runPoll = async () => {
      if (disposed || document.hidden) return
      await refreshOrder(currentOrderKey)
      schedule()
    }

    const handleVisibility = () => {
      if (document.hidden) {
        clearPoll()
        return
      }
      clearPoll()
      void runPoll()
    }

    schedule()
    document.addEventListener("visibilitychange", handleVisibility)
    return () => {
      disposed = true
      clearPoll()
      document.removeEventListener("visibilitychange", handleVisibility)
    }
  }, [currentOrderKey, refreshOrder])

  const setActionStep = useCallback((operation: ActionState, step: ActionStep) => {
    if (actionRef.current?.id !== operation.id) return
    setAction((current) => (current?.id === operation.id ? { ...current, step } : current))
  }, [])

  const beginAction = useCallback((kind: ActionKind): ActionState | null => {
    if (actionRef.current !== null) return null
    const operation: ActionState = {
      id: ++actionSequenceRef.current,
      kind,
      step: kind === "return" ? "submit" : "location",
      orderKey: orderKey(orderRef.current),
    }
    actionRef.current = operation
    orderRequestRef.current += 1
    setAction(operation)
    return operation
  }, [])

  const actionIsCurrent = useCallback((operation: ActionState) => {
    return (
      mountedRef.current &&
      actionRef.current?.id === operation.id &&
      orderKey(orderRef.current) === operation.orderKey
    )
  }, [])

  const finishAction = useCallback((operation: ActionState) => {
    if (actionRef.current?.id !== operation.id) return
    actionRef.current = null
    setAction(null)
  }, [])

  const handleParkCommand = useCallback(
    async (kind: "park" | "continue") => {
      const operation = beginAction(kind)
      if (!operation) return
      const snapshot = orderRef.current
      if (!snapshot.orderNo || !snapshot.userCode) {
        finishAction(operation)
        return
      }

      try {
        const freshCoords = await onRequestLocationRef.current()
        if (!freshCoords || !actionIsCurrent(operation)) return

        setActionStep(operation, "submit")
        if (kind === "park") {
          await client.parkRide(snapshot.orderNo, snapshot.userCode, freshCoords)
        } else {
          await client.continueRide(snapshot.orderNo, snapshot.userCode, freshCoords)
        }
        if (!actionIsCurrent(operation)) return

        setParkedOverride(kind === "park")
        toast.success(
          t(kind === "park" ? "perlica.activeRideParkSuccess" : "perlica.activeRideContinueSuccess")
        )
        setActionStep(operation, "refresh")
        const nextOrder = await client.currentOrder()
        if (!actionIsCurrent(operation)) return
        if (parkedStatus(nextOrder ?? snapshot) !== null || nextOrder === null) {
          setParkedOverride(null)
        }
        onOrderChangeRef.current(nextOrder)
      } catch (error) {
        if (actionIsCurrent(operation)) reportErrorRef.current(error)
      } finally {
        finishAction(operation)
      }
    },
    [actionIsCurrent, beginAction, client, finishAction, setActionStep, t]
  )

  const handleReturnCheck = useCallback(async () => {
    const operation = beginAction("return-check")
    if (!operation) return
    const snapshot = orderRef.current
    if (!snapshot.orderNo || !snapshot.userCode) {
      finishAction(operation)
      return
    }

    try {
      const freshCoords = await onRequestLocationRef.current()
      if (!freshCoords || !actionIsCurrent(operation)) return

      setActionStep(operation, "check")
      const [checkResult, pointsResult] = await Promise.allSettled([
        client.returnCheck(snapshot.userCode),
        client.parkPoints(freshCoords, PARK_POINT_SEARCH_RADIUS_METERS),
      ])
      if (!actionIsCurrent(operation)) return
      if (checkResult.status === "rejected") throw checkResult.reason
      if (pointsResult.status === "rejected") reportErrorRef.current(pointsResult.reason)
      if (!checkResult.value.allowed) {
        toast.error(t("perlica.activeRideReturnCheckFailed"))
        return
      }

      const parking = selectParkingPoints(
        pointsResult.status === "fulfilled" ? pointsResult.value : [],
        freshCoords
      )
      const selectedCoords = parking.snapped
        ? { lat: parking.snapped.lat, lng: parking.snapped.lng }
        : freshCoords
      const dispatch = await client.dispatchCheck(snapshot.orderNo, selectedCoords)
      if (!actionIsCurrent(operation)) return
      if (!dispatch.allowed) {
        toast.error(t("perlica.activeRideReturnCheckFailed"))
        return
      }

      setReturnCandidate({
        orderKey: operation.orderKey,
        orderNo: snapshot.orderNo,
        userCode: snapshot.userCode,
        coords: selectedCoords,
        fee: fallbackDispatchFee(dispatch),
        parkPoints: parking.points,
        parkPoint: parking.snapped,
      })
    } catch (error) {
      if (actionIsCurrent(operation)) reportErrorRef.current(error)
    } finally {
      finishAction(operation)
    }
  }, [actionIsCurrent, beginAction, client, finishAction, setActionStep, t])

  const handleSelectParkPoint = useCallback(
    async (point: PerlicaParkPoint) => {
      const candidate = returnCandidate
      if (!candidate || candidate.parkPoint === point) return
      const operation = beginAction("return-check")
      if (!operation || candidate.orderKey !== operation.orderKey) {
        if (operation) finishAction(operation)
        return
      }

      const coords = { lat: point.lat, lng: point.lng }
      setActionStep(operation, "check")
      try {
        const dispatch = await client.dispatchCheck(candidate.orderNo, coords)
        if (!actionIsCurrent(operation)) return
        if (!dispatch.allowed) {
          toast.error(t("perlica.activeRideReturnCheckFailed"))
          return
        }
        setReturnCandidate({
          ...candidate,
          coords,
          parkPoint: point,
          fee: fallbackDispatchFee(dispatch),
        })
      } catch (error) {
        if (actionIsCurrent(operation)) reportErrorRef.current(error)
      } finally {
        finishAction(operation)
      }
    },
    [actionIsCurrent, beginAction, client, finishAction, returnCandidate, setActionStep, t]
  )

  const handleReturn = useCallback(async () => {
    const candidate = returnCandidate
    if (!candidate || candidate.orderKey !== orderKey(orderRef.current)) return
    const operation = beginAction("return")
    if (!operation) return

    try {
      await client.returnBike(candidate.orderNo, candidate.coords)
      if (!actionIsCurrent(operation)) return

      setActionStep(operation, "verify")
      await client.currentOrder()
      if (!actionIsCurrent(operation)) return

      await delay(RETURN_RECHECK_DELAY_MS)
      if (!actionIsCurrent(operation)) return
      const delayedOrder = await client.currentOrder()
      if (!actionIsCurrent(operation)) return

      onOrderChangeRef.current(delayedOrder)
      setReturnCandidate(null)
      if (sameOrder(delayedOrder, candidate)) {
        toast.error(t("perlica.activeRideReturnUnconfirmed"))
      } else {
        toast.success(t("perlica.activeRideReturnSuccess"))
      }
    } catch (error) {
      if (!actionIsCurrent(operation)) return
      try {
        const latestOrder = await client.currentOrder()
        if (!actionIsCurrent(operation)) return
        onOrderChangeRef.current(latestOrder)
        setReturnCandidate(null)
        if (sameOrder(latestOrder, candidate)) {
          toast.error(t("perlica.activeRideReturnUnconfirmed"))
        } else {
          toast.success(t("perlica.activeRideReturnSuccess"))
        }
      } catch {
        if (actionIsCurrent(operation)) reportErrorRef.current(error)
      }
    } finally {
      finishAction(operation)
    }
  }, [actionIsCurrent, beginAction, client, finishAction, returnCandidate, setActionStep, t])

  const fee =
    returnCandidate?.fee === null || returnCandidate?.fee === undefined
      ? t("perlica.activeRideFeeUnavailable")
      : `¥${returnCandidate.fee.toFixed(2)}`

  return (
    <>
      <Card className="gap-0 rounded-2xl py-0">
        <div className="bg-primary/[0.06] p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Bike className="size-4" />
              {t("perlica.activeRideTitle")}
            </div>
            <Badge variant={isParked ? "secondary" : "outline"} className="bg-background/70">
              {isParked ? <Pause data-icon="inline-start" /> : <Bike data-icon="inline-start" />}
              {t(isParked ? "perlica.activeRideParked" : "perlica.activeRideRiding")}
            </Badge>
          </div>
          <div className="mt-7 text-center">
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" />
              {t("perlica.activeRideElapsed")}
            </div>
            <div className="mt-2 font-mono text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">
              {elapsed === null ? t("perlica.activeRideUnknownTime") : elapsedText(elapsed)}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("perlica.activeRideStartTime")} · {order.startTime || "—"}
            </p>
          </div>
        </div>
        <CardContent className="flex flex-col gap-5 p-4">
          <dl className="rounded-xl bg-muted/50 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t("perlica.activeRideUserCode")}</dt>
            <dd className="mt-1 font-mono text-base font-semibold break-all">
              {order.userCode || "—"}
            </dd>
          </dl>

          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="lg"
              className="h-12 rounded-xl"
              onClick={() => void handleParkCommand(isParked ? "continue" : "park")}
              disabled={busy || !order.orderNo || !order.userCode}
            >
              {isParked ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
              {action?.kind === (isParked ? "continue" : "park") && currentActionMessage
                ? currentActionMessage
                : t(isParked ? "perlica.activeRideContinue" : "perlica.activeRidePark")}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="h-12 rounded-xl"
              onClick={() => void handleReturnCheck()}
              disabled={busy || !order.orderNo || !order.userCode}
            >
              <RotateCcw data-icon="inline-start" />
              {(action?.kind === "return-check" || action?.kind === "return") &&
              currentActionMessage
                ? currentActionMessage
                : t("perlica.activeRideReturn")}
            </Button>
          </div>

          {currentActionMessage ? (
            <div
              aria-live="polite"
              role="status"
              className="text-center text-sm text-muted-foreground"
            >
              {currentActionMessage}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ResponsiveModal
        open={returnCandidate !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setReturnCandidate(null)
        }}
      >
        <ResponsiveModalContent className="sm:max-w-lg" drawerClassName="gap-0">
          <ResponsiveModalHeader className="text-left">
            <ResponsiveModalTitle>{t("perlica.activeRideReturnDialogTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {t("perlica.activeRideReturnDialogDescription")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="space-y-4" data-vaul-no-drag>
            {returnCandidate ? (
              <>
                {returnCandidate.parkPoint ? (
                  <div className="flex items-start gap-2 rounded-xl bg-primary/[0.07] p-3 text-sm">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-medium">{t("perlica.activeRideAutoSnapped")}</p>
                      <p className="mt-0.5 text-muted-foreground">
                        {returnCandidate.parkPoint.name || returnCandidate.parkPoint.address}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">
                    {t("perlica.activeRideUsingCurrentLocation")}
                  </p>
                )}

                {returnCandidate.parkPoints.length > 0 ? (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">{t("perlica.activeRideParkingPoint")}</h3>
                    <div
                      role="radiogroup"
                      aria-label={t("perlica.activeRideParkingPoint")}
                      className="max-h-56 space-y-2 overflow-y-auto"
                    >
                      {returnCandidate.parkPoints.map((point) => {
                        const selected = returnCandidate.parkPoint === point
                        return (
                          <Button
                            key={point.id || `${point.lat},${point.lng}`}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            variant="outline"
                            disabled={busy}
                            onClick={() => void handleSelectParkPoint(point)}
                            className={`h-auto w-full justify-start gap-3 rounded-xl px-3 py-3 text-left whitespace-normal ${
                              selected ? "border-primary bg-primary/[0.06]" : ""
                            }`}
                          >
                            <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">
                                {point.name || point.address || t("perlica.activeRideParkingPoint")}
                              </span>
                              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                {t("perlica.activeRideParkingPointDistance", {
                                  distance: Math.round(point.distance),
                                })}
                              </span>
                            </span>
                            {selected ? (
                              <CheckCircle2 className="size-4 shrink-0 text-primary" />
                            ) : null}
                          </Button>
                        )
                      })}
                    </div>
                  </section>
                ) : null}

                <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-sm">
                  <span className="text-muted-foreground">
                    {t("perlica.activeRideDispatchType")}
                  </span>
                  <span className="text-right font-mono font-medium">{DISPATCH_TYPE}</span>
                  <span className="text-muted-foreground">
                    {t("perlica.activeRideDispatchFee")}
                  </span>
                  <span className="text-right font-medium">{fee}</span>
                </div>
                {currentActionMessage ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {currentActionMessage}
                  </p>
                ) : null}
              </>
            ) : null}
          </ResponsiveModalBody>
          <ResponsiveModalFooter className="flex-row" drawerClassName="flex-row">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setReturnCandidate(null)}
              disabled={busy}
            >
              {t("perlica.activeRideCancel")}
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => void handleReturn()}
              disabled={busy || !returnCandidate}
            >
              <RotateCcw data-icon="inline-start" />
              {action?.kind === "return" && currentActionMessage
                ? currentActionMessage
                : t("perlica.activeRideConfirmReturn")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  )
}
