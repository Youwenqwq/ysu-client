"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  BellRing,
  CheckCircle2,
  LocateFixed,
  LockOpen,
  MapPin,
  RefreshCw,
  TriangleAlert,
} from "lucide-react"
import { toast } from "@ysu/plugin-sdk/host"
import { Alert, AlertDescription, AlertTitle } from "@ysu/plugin-ui/components"
import { Badge } from "@ysu/plugin-ui/components"
import { Button } from "@ysu/plugin-ui/components"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ysu/plugin-ui/components"
import { PerlicaRouteMap } from "./perlica-route-map"
import type { PerlicaClient } from "../extras/client"
import type {
  PerlicaCoords,
  PerlicaMachine,
  PerlicaMachineFee,
  PerlicaMachineStatus,
  PerlicaOrder,
} from "../extras/types"
import { usePluginTranslation } from "@ysu/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { cn } from "@ysu/plugin-ui/components"

const MACHINE_POLL_INTERVAL = 20_000
const ORDER_RECONCILE_DELAYS = [700, 1500]
export interface PerlicaMachineDetailProps {
  client: PerlicaClient
  code: string
  machine: PerlicaMachine | null
  coords: PerlicaCoords
  locationConfirmed: boolean
  currentOrder: PerlicaOrder | null
  onOrderChange: (order: PerlicaOrder | null) => void
  onBorrowSuccess: (order: PerlicaOrder) => void
  onRequestLocation: () => Promise<PerlicaCoords | null>
  onShowOrder: () => void
  reportError: (error: unknown) => void
}

type UnlockCandidate = {
  code: string
  userCode: string
  machineNo: string
  coords: PerlicaCoords
  borrowPosLogId: string
  status: PerlicaMachineStatus
  fee: PerlicaMachineFee
  warnings: string[]
}

type MachineSnapshot = {
  status: PerlicaMachineStatus
  fee: PerlicaMachineFee
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

function safeText(value: unknown): string {
  return firstText(value)
    .replace(/TOKEN:[^\s&?#]+/gi, "[redacted]")
    .replace(/https?:\/\/\S+/gi, "[URL removed]")
}

function displayText(value: unknown): string {
  return safeText(value) || "—"
}

function validCoords(coords: PerlicaCoords): boolean {
  return (
    Number.isFinite(coords.lat) &&
    Number.isFinite(coords.lng) &&
    Math.abs(coords.lat) <= 90 &&
    Math.abs(coords.lng) <= 180 &&
    (coords.lat !== 0 || coords.lng !== 0)
  )
}

function machineMatchesCode(machine: PerlicaMachine | null, code: string): boolean {
  if (!machine) return false
  const userCode = firstText(machine.userCode, machine.raw.userCode, machine.raw.user_code)
  const machineNo = firstText(
    machine.machineNo,
    machine.raw.machineNo,
    machine.raw.machineNO,
    machine.raw.machine_no,
    machine.raw.code
  )
  return (code.length === 8 && userCode === code) || (code.length === 9 && machineNo === code)
}

function resolveMachineIds(
  code: string,
  machine: PerlicaMachine | null,
  status: PerlicaMachineStatus | null,
  fee: PerlicaMachineFee | null
) {
  return {
    userCode: firstText(
      machine?.userCode,
      machine?.raw.userCode,
      machine?.raw.user_code,
      status?.raw.userCode,
      status?.raw.user_code,
      code.length === 8 ? code : ""
    ),
    machineNo: firstText(
      machine?.machineNo,
      status?.machineNo,
      fee?.machineNo,
      machine?.raw.machineNo,
      machine?.raw.machineNO,
      machine?.raw.machine_no,
      machine?.raw.code,
      status?.raw.machineNo,
      status?.raw.machineNO,
      status?.raw.machine_no,
      status?.raw.code,
      code.length === 9 ? code : ""
    ),
  }
}

function normalizedPrice(fee: PerlicaMachineFee): number {
  return Number.isFinite(fee.price) && fee.price >= 0 ? fee.price : 0
}

function formatAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatDistance(value: number | null): string {
  if (value === null) return "—"
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} km`
  return `${formatAmount(value)} m`
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right break-words">{value}</span>
    </div>
  )
}

export function PerlicaMachineDetail({
  client,
  code,
  machine,
  coords,
  locationConfirmed,
  currentOrder,
  onOrderChange,
  onBorrowSuccess,
  onRequestLocation,
  onShowOrder,
  reportError,
}: PerlicaMachineDetailProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const normalizedCode = code.trim()
  const codeRef = useRef(normalizedCode)
  const machineRef = useRef(machine)
  const resolveErrorReportedRef = useRef("")
  const mountedRef = useRef(true)
  const onOrderChangeRef = useRef(onOrderChange)
  const onBorrowSuccessRef = useRef(onBorrowSuccess)
  const reportErrorRef = useRef(reportError)

  useEffect(() => {
    codeRef.current = normalizedCode
    machineRef.current = machine
    onOrderChangeRef.current = onOrderChange
    onBorrowSuccessRef.current = onBorrowSuccess
    reportErrorRef.current = reportError
  }, [machine, normalizedCode, onBorrowSuccess, onOrderChange, reportError])

  const [status, setStatus] = useState<PerlicaMachineStatus | null>(null)
  const [fee, setFee] = useState<PerlicaMachineFee | null>(null)
  const [machineLoading, setMachineLoading] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [ringing, setRinging] = useState(false)
  const [locating, setLocating] = useState(false)
  const [candidate, setCandidate] = useState<UnlockCandidate | null>(null)

  const machineRequestRef = useRef(0)
  const orderRequestRef = useRef(0)
  const prepareRequestRef = useRef(0)
  const prepareLockRef = useRef(false)
  const borrowLockRef = useRef(false)
  const ringLockRef = useRef(false)
  const locateLockRef = useRef(false)
  const reconcileTimersRef = useRef<number[]>([])

  const clearReconciliations = useCallback(() => {
    for (const timer of reconcileTimersRef.current) clearTimeout(timer)
    reconcileTimersRef.current = []
  }, [])

  const queryMachine = useCallback(
    async (targetCode: string, requestId: number): Promise<MachineSnapshot | null> => {
      const currentMachine = machineRef.current
      const matchedMachine = machineMatchesCode(currentMachine, targetCode) ? currentMachine : null
      const queryUserCode = resolveMachineIds(targetCode, matchedMachine, null, null).userCode
      if (!queryUserCode) {
        if (mountedRef.current && codeRef.current === targetCode) {
          setMachineLoading(false)
          if (resolveErrorReportedRef.current !== targetCode) {
            resolveErrorReportedRef.current = targetCode
            toast.error(t("perlica.machineResolveFailed"))
          }
        }
        return null
      }
      resolveErrorReportedRef.current = ""
      try {
        const [nextStatus, nextFee] = await Promise.all([
          client.machineStatus(queryUserCode),
          client.machineFee(queryUserCode),
        ])
        const current =
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === machineRequestRef.current
        if (!current) return null
        setStatus(nextStatus)
        setFee(nextFee)
        return { status: nextStatus, fee: nextFee }
      } catch (error) {
        if (
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === machineRequestRef.current
        ) {
          reportErrorRef.current(error)
        }
        return null
      } finally {
        if (
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === machineRequestRef.current
        ) {
          setMachineLoading(false)
        }
      }
    },
    [client, t]
  )

  const queryOrder = useCallback(
    async (
      targetCode: string,
      requestId: number
    ): Promise<{ order: PerlicaOrder | null } | null> => {
      try {
        const order = await client.currentOrder()
        const current =
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === orderRequestRef.current
        if (!current) return null
        onOrderChangeRef.current(order)
        return { order }
      } catch (error) {
        if (
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === orderRequestRef.current
        ) {
          reportErrorRef.current(error)
        }
        return null
      } finally {
        if (
          mountedRef.current &&
          codeRef.current === targetCode &&
          requestId === orderRequestRef.current
        ) {
          setOrderLoading(false)
        }
      }
    },
    [client]
  )

  const refreshMachine = useCallback(
    (targetCode: string) => {
      if (!targetCode) return
      const requestId = ++machineRequestRef.current
      setMachineLoading(true)
      void queryMachine(targetCode, requestId)
    },
    [queryMachine]
  )

  const refreshOrder = useCallback(
    (targetCode: string) => {
      if (!targetCode) return
      const requestId = ++orderRequestRef.current
      setOrderLoading(true)
      void queryOrder(targetCode, requestId)
    },
    [queryOrder]
  )

  const scheduleOrderReconciliation = useCallback(
    (targetCode: string) => {
      clearReconciliations()
      for (const delay of ORDER_RECONCILE_DELAYS) {
        const timer = window.setTimeout(() => {
          if (mountedRef.current && codeRef.current === targetCode) refreshOrder(targetCode)
        }, delay)
        reconcileTimersRef.current.push(timer)
      }
    },
    [clearReconciliations, refreshOrder]
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      machineRequestRef.current += 1
      orderRequestRef.current += 1
      prepareRequestRef.current += 1
      clearReconciliations()
    }
  }, [clearReconciliations])

  useEffect(() => {
    prepareRequestRef.current += 1
    clearReconciliations()
    setCandidate(null)
    setStatus(null)
    setFee(null)
    setPreparing(false)
    setUnlocking(false)
    setRinging(false)
    if (!normalizedCode) {
      machineRequestRef.current += 1
      orderRequestRef.current += 1
      setMachineLoading(false)
      setOrderLoading(false)
      return
    }
    const machineRequestId = ++machineRequestRef.current
    const orderRequestId = ++orderRequestRef.current
    setMachineLoading(true)
    setOrderLoading(true)
    void queryMachine(normalizedCode, machineRequestId)
    void queryOrder(normalizedCode, orderRequestId)
  }, [clearReconciliations, normalizedCode, queryMachine, queryOrder])

  useEffect(() => {
    if (!normalizedCode) return
    const poll = () => {
      if (
        document.visibilityState === "visible" &&
        !prepareLockRef.current &&
        !borrowLockRef.current
      ) {
        refreshMachine(normalizedCode)
      }
    }
    const interval = window.setInterval(poll, MACHINE_POLL_INTERVAL)
    document.addEventListener("visibilitychange", poll)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", poll)
    }
  }, [normalizedCode, refreshMachine])

  const selectedMachine = useMemo(
    () => (machineMatchesCode(machine, normalizedCode) ? machine : null),
    [machine, normalizedCode]
  )
  const ids = useMemo(
    () => resolveMachineIds(normalizedCode, selectedMachine, status, fee),
    [fee, normalizedCode, selectedMachine, status]
  )
  const hasConfirmedCoords = locationConfirmed && validCoords(coords)
  const position =
    status && validCoords({ lat: status.lat, lng: status.lng })
      ? { lat: status.lat, lng: status.lng }
      : null
  const battery = firstNumber(status?.battery, selectedMachine?.battery)
  const distance = firstNumber(selectedMachine?.distance, status?.raw.distance)
  const surplusMileage = firstText(
    status?.raw.surplusMileage,
    status?.raw.remainingMileage,
    selectedMachine?.raw.surplusMileage,
    selectedMachine?.raw.remainingMileage
  )
  const positionTime = firstText(
    status?.raw.posDt,
    status?.raw.positionTime,
    status?.raw.posTime,
    status?.raw.gpsTime,
    status?.raw.lastPositionTime,
    status?.raw.updateTime,
    selectedMachine?.raw.posDt,
    selectedMachine?.raw.positionTime
  )
  const address = firstText(
    status?.raw.address,
    status?.raw.addr,
    status?.raw.locationName,
    status?.raw.positionAddress,
    selectedMachine?.address,
    selectedMachine?.raw.address,
    selectedMachine?.raw.addr,
    selectedMachine?.raw.locationName
  )
  const feeDescription = safeText(fee?.description)
  const feeAmount = fee ? (firstNumber(fee.fee, fee.price) ?? 0) : null

  function refreshAll() {
    if (!normalizedCode) return
    refreshMachine(normalizedCode)
    refreshOrder(normalizedCode)
  }

  async function handleLocate() {
    if (locateLockRef.current) return
    locateLockRef.current = true
    setLocating(true)
    try {
      const result = await onRequestLocation()
      if (result) toast.success(t("perlica.locationUpdated"))
    } catch (error) {
      reportErrorRef.current(error)
    } finally {
      locateLockRef.current = false
      if (mountedRef.current) setLocating(false)
    }
  }

  async function handleRing() {
    if (ringLockRef.current || !normalizedCode || !ids.userCode || !hasConfirmedCoords) {
      if (!hasConfirmedCoords) toast.error(t("perlica.locationRequired"))
      return
    }
    const targetCode = normalizedCode
    const snapshot = { lat: coords.lat, lng: coords.lng }
    const ringIds = { ...ids }
    ringLockRef.current = true
    setRinging(true)
    try {
      await client.ring(ringIds.userCode, ringIds.machineNo, snapshot)
      if (mountedRef.current && codeRef.current === targetCode) {
        toast.success(t("perlica.ringSuccess"))
      }
    } catch (error) {
      if (mountedRef.current && codeRef.current === targetCode) reportErrorRef.current(error)
    } finally {
      ringLockRef.current = false
      if (mountedRef.current && codeRef.current === targetCode) setRinging(false)
    }
  }

  async function handlePrepare() {
    if (
      prepareLockRef.current ||
      borrowLockRef.current ||
      !normalizedCode ||
      !ids.userCode ||
      !hasConfirmedCoords
    ) {
      if (!hasConfirmedCoords) toast.error(t("perlica.locationRequired"))
      return
    }
    const targetCode = normalizedCode
    const targetUserCode = ids.userCode
    const snapshot = { lat: coords.lat, lng: coords.lng }
    const prepareRequestId = ++prepareRequestRef.current
    prepareLockRef.current = true
    setPreparing(true)
    setCandidate(null)
    try {
      const prepared = await client.prepareMachine(targetUserCode, snapshot)
      if (
        !mountedRef.current ||
        codeRef.current !== targetCode ||
        prepareRequestId !== prepareRequestRef.current
      ) {
        return
      }

      const machineRequestId = ++machineRequestRef.current
      const orderRequestId = ++orderRequestRef.current
      setMachineLoading(true)
      setOrderLoading(true)
      const [machineResult, orderResult] = await Promise.all([
        queryMachine(targetCode, machineRequestId),
        queryOrder(targetCode, orderRequestId),
      ])
      if (
        !mountedRef.current ||
        codeRef.current !== targetCode ||
        prepareRequestId !== prepareRequestRef.current ||
        !machineResult ||
        !orderResult
      ) {
        return
      }

      if (orderResult.order) {
        const order = orderResult.order
        const latestIds = resolveMachineIds(
          targetCode,
          selectedMachine,
          machineResult.status,
          machineResult.fee
        )
        const ownOrder = [order.userCode, order.machineNo].some(
          (value) =>
            Boolean(value) &&
            (value === targetCode || value === latestIds.userCode || value === latestIds.machineNo)
        )
        setCandidate(null)
        toast.error(
          t(ownOrder ? "perlica.unlockBlockedOwnOrder" : "perlica.unlockBlockedOtherOrder")
        )
        onShowOrder()
        return
      }

      const latestIds = resolveMachineIds(
        targetCode,
        selectedMachine,
        machineResult.status,
        machineResult.fee
      )
      setCandidate({
        code: targetCode,
        userCode: latestIds.userCode,
        machineNo: latestIds.machineNo,
        coords: snapshot,
        borrowPosLogId: prepared.borrowPosLogId,
        status: machineResult.status,
        fee: machineResult.fee,
        warnings: prepared.warnings.map(safeText).filter(Boolean),
      })
    } catch (error) {
      if (
        mountedRef.current &&
        codeRef.current === targetCode &&
        prepareRequestId === prepareRequestRef.current
      ) {
        reportErrorRef.current(error)
      }
    } finally {
      prepareLockRef.current = false
      if (
        mountedRef.current &&
        codeRef.current === targetCode &&
        prepareRequestId === prepareRequestRef.current
      ) {
        setPreparing(false)
      }
    }
  }

  async function handleBorrow() {
    if (!candidate || borrowLockRef.current || candidate.code !== normalizedCode) return
    if (!locationConfirmed || !validCoords(candidate.coords)) {
      toast.error(t("perlica.locationRequired"))
      return
    }
    const confirmedCandidate = candidate
    borrowLockRef.current = true
    orderRequestRef.current += 1
    setOrderLoading(false)
    setUnlocking(true)
    try {
      const result = await client.borrowBike(
        confirmedCandidate.userCode,
        confirmedCandidate.coords,
        confirmedCandidate.borrowPosLogId
      )
      orderRequestRef.current += 1
      const optimisticOrder: PerlicaOrder = {
        ...result,
        userCode: result.userCode || confirmedCandidate.userCode,
        machineNo: result.machineNo || confirmedCandidate.machineNo,
        startTime: result.startTime || new Date().toISOString(),
      }
      onBorrowSuccessRef.current(optimisticOrder)
      toast.success(t("perlica.unlockSuccess"))
      if (mountedRef.current) {
        setCandidate(null)
        if (codeRef.current === confirmedCandidate.code) {
          scheduleOrderReconciliation(confirmedCandidate.code)
        }
      }
    } catch (error) {
      if (mountedRef.current && codeRef.current === confirmedCandidate.code) {
        reportErrorRef.current(error)
      }
    } finally {
      borrowLockRef.current = false
      if (mountedRef.current && codeRef.current === confirmedCandidate.code) setUnlocking(false)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6 px-4 py-5 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="size-4 shrink-0" />
            <span className="truncate">
              {t("perlica.selectedMachine", { machineNo: ids.machineNo || normalizedCode })}
            </span>
          </p>
          {status ? (
            <Badge variant={status.online ? "secondary" : "outline"} className="shrink-0">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  status.online ? "bg-emerald-500" : "bg-muted-foreground"
                )}
              />
              {status.online ? t("perlica.online") : t("perlica.offline")}
            </Badge>
          ) : null}
        </div>
        {currentOrder ? (
          <Alert>
            <TriangleAlert />
            <AlertTitle>{t("perlica.currentOrderPresent")}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{t("perlica.currentOrderUnlockHint")}</span>
              <Button type="button" size="sm" variant="outline" onClick={onShowOrder}>
                {t("perlica.showCurrentOrder")}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-x-8 gap-y-4 border-t pt-4 sm:grid-cols-2">
          <DetailRow label={t("perlica.userCode")} value={displayText(ids.userCode)} />
          <DetailRow label={t("perlica.machineNo")} value={displayText(ids.machineNo)} />
          <DetailRow
            label={t("perlica.status")}
            value={status ? displayText(status.status) : t("perlica.notLoaded")}
          />
          <DetailRow label={t("perlica.battery")} value={battery === null ? "—" : `${battery}%`} />
          <DetailRow label={t("perlica.distance")} value={formatDistance(distance)} />
          <DetailRow label={t("perlica.surplusMileage")} value={displayText(surplusMileage)} />
          <DetailRow
            label={t("perlica.fee")}
            value={
              fee
                ? feeDescription ||
                  `${formatAmount(feeAmount ?? 0)}${fee.unit ? ` ${fee.unit}` : ""}`
                : t("perlica.notLoaded")
            }
          />
          <DetailRow label={t("perlica.positionTime")} value={displayText(positionTime)} />
        </div>
        <div className="border-b pb-4">
          <DetailRow label={t("perlica.address")} value={displayText(address)} />
        </div>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-w-0 px-2 text-xs sm:text-sm"
              onClick={refreshAll}
              disabled={!normalizedCode || machineLoading || orderLoading || preparing || unlocking}
            >
              <RefreshCw
                data-icon="inline-start"
                className={cn((machineLoading || orderLoading) && "animate-spin")}
              />
              <span className="truncate">{t("perlica.refresh")}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-w-0 px-2 text-xs sm:text-sm"
              onClick={() => void handleLocate()}
              disabled={locating || preparing || unlocking}
            >
              <LocateFixed data-icon="inline-start" />
              <span className="truncate">
                {locating ? t("perlica.locating") : t("perlica.locate")}
              </span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-w-0 px-2 text-xs sm:text-sm"
              onClick={() => void handleRing()}
              disabled={ringing || preparing || unlocking || !hasConfirmedCoords || !ids.userCode}
            >
              <BellRing data-icon="inline-start" />
              <span className="truncate">{ringing ? t("perlica.ringing") : t("perlica.ring")}</span>
            </Button>
          </div>
          <Button
            type="button"
            size="lg"
            onClick={() => void handlePrepare()}
            disabled={
              !normalizedCode ||
              !ids.userCode ||
              !hasConfirmedCoords ||
              preparing ||
              unlocking ||
              machineLoading ||
              ringing
            }
          >
            <LockOpen data-icon="inline-start" />
            {preparing ? t("perlica.preparing") : t("perlica.unlock")}
          </Button>
        </div>
        {!hasConfirmedCoords ? (
          <p className="text-sm text-muted-foreground">{t("perlica.locationRequired")}</p>
        ) : null}

        <section className="flex flex-col gap-3 border-t pt-6">
          <h3 className="text-sm font-medium">{t("perlica.position")}</h3>
          {position ? (
            <PerlicaRouteMap
              start={position}
              startName={safeText(address) || displayText(ids.machineNo)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t("perlica.noStatusPosition")}</p>
          )}
        </section>
      </div>

      <Dialog
        open={candidate !== null}
        onOpenChange={(open) => {
          if (!open && !unlocking) setCandidate(null)
        }}
      >
        <DialogContent showCloseButton={!unlocking}>
          <DialogHeader>
            <DialogTitle>{t("perlica.unlockTitle")}</DialogTitle>
            <DialogDescription>{t("perlica.unlockDescription")}</DialogDescription>
          </DialogHeader>
          {candidate ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                <div>
                  <div className="font-medium">{t("perlica.preparationComplete")}</div>
                  <p className="mt-1 text-muted-foreground">
                    {t("perlica.preparationStepDescription")}
                  </p>
                </div>
              </div>
              {candidate.warnings.length > 0 ? (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>{t("perlica.preparationWarnings")}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {candidate.warnings.map((warning, index) => (
                        <li key={`${index}-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}
              <DetailRow label={t("perlica.userCode")} value={displayText(candidate.userCode)} />
              <DetailRow label={t("perlica.machineNo")} value={displayText(candidate.machineNo)} />
              <DetailRow label={t("perlica.status")} value={displayText(candidate.status.status)} />
              <DetailRow
                label={t("perlica.fee")}
                value={
                  safeText(candidate.fee.description) ||
                  `${formatAmount(normalizedPrice(candidate.fee))}${
                    candidate.fee.unit ? ` ${candidate.fee.unit}` : ""
                  }`
                }
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCandidate(null)}
              disabled={unlocking}
            >
              {t("perlica.cancel")}
            </Button>
            <Button type="button" onClick={() => void handleBorrow()} disabled={unlocking}>
              <LockOpen data-icon="inline-start" />
              {unlocking ? t("perlica.unlocking") : t("perlica.confirmUnlock")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
