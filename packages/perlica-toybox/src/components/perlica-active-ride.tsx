"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bike, Clock3, Pause, Play, RotateCcw } from "lucide-react"
import { toast } from "@orahako/plugin-sdk/host"
import { Badge } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@orahako/plugin-ui/components"
import type { PerlicaClient } from "../extras/client"
import type { PerlicaCoords, PerlicaDispatchCheck, PerlicaOrder } from "../extras/types"
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
  fee: number | string | null
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

function fallbackDispatchFee(dispatch: PerlicaDispatchCheck): number | string | null {
  const optionFee = dispatch.options.find((option) => option.type === DISPATCH_TYPE)?.money
  if (optionFee !== undefined) return optionFee

  for (const key of ["dispatchFee", "fee", "dispatchPrice", "amount", "price", "money"]) {
    const value = dispatch.raw[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim()) return value
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
      const check = await client.returnCheck(snapshot.userCode)
      if (!actionIsCurrent(operation)) return
      if (!check.allowed) {
        toast.error(t("perlica.activeRideReturnCheckFailed"))
        return
      }

      const dispatch = await client.dispatchCheck(snapshot.orderNo, freshCoords)
      if (!actionIsCurrent(operation)) return
      if (!dispatch.allowed) {
        toast.error(t("perlica.activeRideReturnCheckFailed"))
        return
      }

      setReturnCandidate({
        orderKey: operation.orderKey,
        orderNo: snapshot.orderNo,
        userCode: snapshot.userCode,
        coords: freshCoords,
        fee: fallbackDispatchFee(dispatch),
      })
    } catch (error) {
      if (actionIsCurrent(operation)) reportErrorRef.current(error)
    } finally {
      finishAction(operation)
    }
  }, [actionIsCurrent, beginAction, client, finishAction, setActionStep, t])

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
      : `¥${returnCandidate.fee}`

  return (
    <>
      <section className="flex flex-col gap-7">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Bike className="size-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold tracking-tight">
                  {t("perlica.activeRideTitle")}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {order.status ||
                    t(isParked ? "perlica.activeRideParked" : "perlica.activeRideRiding")}
                </p>
              </div>
            </div>
            <Badge variant={isParked ? "secondary" : "outline"} className="px-2.5 py-1">
              {isParked ? <Pause data-icon="inline-start" /> : <Bike data-icon="inline-start" />}
              {t(isParked ? "perlica.activeRideParked" : "perlica.activeRideRiding")}
            </Badge>
          </div>
        </header>

        <div className="flex flex-col gap-7">
          <div className="border-y py-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="size-4" />
              {t("perlica.activeRideElapsed")}
            </div>
            <div className="mt-2 font-mono text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {elapsed === null ? t("perlica.activeRideUnknownTime") : elapsedText(elapsed)}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("perlica.activeRideStartTime")}: {order.startTime || "—"}
            </p>
          </div>

          <dl className="grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("perlica.activeRideUserCode")}</dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold break-all">
                {order.userCode || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("perlica.activeRideMachineNo")}</dt>
              <dd className="mt-1.5 font-mono text-lg font-semibold break-all">
                {order.machineNo || "—"}
              </dd>
            </div>
          </dl>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void handleParkCommand("park")}
              disabled={busy || !order.orderNo || !order.userCode}
            >
              <Pause data-icon="inline-start" />
              {action?.kind === "park" && currentActionMessage
                ? currentActionMessage
                : t("perlica.activeRidePark")}
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => void handleParkCommand("continue")}
              disabled={busy || !order.orderNo || !order.userCode}
            >
              <Play data-icon="inline-start" />
              {action?.kind === "continue" && currentActionMessage
                ? currentActionMessage
                : t("perlica.activeRideContinue")}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="sm:col-span-2"
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

          <div aria-live="polite" role="status" className="min-h-5 text-sm text-muted-foreground">
            {currentActionMessage}
          </div>
        </div>
      </section>

      <Dialog
        open={returnCandidate !== null}
        onOpenChange={(open) => {
          if (!open && action?.kind !== "return") setReturnCandidate(null)
        }}
      >
        <DialogContent showCloseButton={action?.kind !== "return"}>
          <DialogHeader>
            <DialogTitle>{t("perlica.activeRideReturnDialogTitle")}</DialogTitle>
            <DialogDescription>{t("perlica.activeRideReturnDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-3 text-sm">
            <span className="text-muted-foreground">{t("perlica.activeRideDispatchType")}</span>
            <span className="text-right font-mono font-medium">{DISPATCH_TYPE}</span>
            <span className="text-muted-foreground">{t("perlica.activeRideDispatchFee")}</span>
            <span className="text-right font-medium">{fee}</span>
          </div>
          {action?.kind === "return" && currentActionMessage ? (
            <p role="status" className="text-sm text-muted-foreground">
              {currentActionMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReturnCandidate(null)}
              disabled={action?.kind === "return"}
            >
              {t("perlica.activeRideCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleReturn()}
              disabled={busy || !returnCandidate}
            >
              <RotateCcw data-icon="inline-start" />
              {action?.kind === "return" && currentActionMessage
                ? currentActionMessage
                : t("perlica.activeRideConfirmReturn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
