"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  ArrowRight,
  Bike,
  ChevronUp,
  Loader2,
  LocateFixed,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  TriangleAlert,
  X,
} from "lucide-react"
import { useMobileHeaderRight } from "@orahako/plugin-ui/stores"
import { Geolocation, toast } from "@orahako/plugin-sdk/host"
import { pluginPageHref, type PluginPageProps } from "@orahako/plugin-sdk"
import { PerlicaAccount } from "./components/perlica-account"
import { PerlicaActiveRide } from "./components/perlica-active-ride"
import { PerlicaHistory } from "./components/perlica-history"
import { PerlicaMachineDetail } from "./components/perlica-machine-detail"
import { PerlicaMap } from "./components/perlica-map"
import { PerlicaNearbyList } from "./components/perlica-nearby-list"
import { PerlicaScanner } from "./components/perlica-scanner"
import { PERLICA_PLUGIN_ID, PERLICA_PAGE_INDEX, PERLICA_PAGE_SETTINGS } from "./constants"
import { isPerlicaTab, perlicaTab, type PerlicaTab } from "./extras/app-nav"
import { Alert, AlertDescription, AlertTitle } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@orahako/plugin-ui/components"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@orahako/plugin-ui/components"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@orahako/plugin-ui/components"
import { Skeleton } from "@orahako/plugin-ui/components"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@orahako/plugin-ui/components"
import { ToggleGroup, ToggleGroupItem } from "@orahako/plugin-ui/components"
import { readPerlicaSnapshot, writePerlicaSnapshot } from "./extras/cache"
import { PerlicaError } from "./extras/client"
import { parsePerlicaCode } from "./extras/scan"
import { getPerlicaClient, usePerlicaStore } from "./extras/store"
import type {
  PerlicaCoords,
  PerlicaGeoArea,
  PerlicaMachine,
  PerlicaOrder,
  PerlicaParkPoint,
  PerlicaRideCard,
  PerlicaRideLog,
  PerlicaStation,
  PerlicaUserInfo,
} from "./extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { cn } from "@orahako/plugin-ui/components"

const RADII = [300, 1000, 3000, 5000, 10000]
const PAGE_SIZE = 10
const MAP_TTL = 60_000
const ACCOUNT_TTL = 5 * 60_000
const GEO_TTL = 10 * 60_000

function formatRadius(value: number): string {
  return value >= 1000 ? `${value / 1000}km` : `${value}m`
}

function safeServiceMessage(error: PerlicaError) {
  return (
    error.message
      .replace(/TOKEN:[^\s&?#]+/gi, "[redacted]")
      .replace(/https?:\/\/\S+/gi, "[URL removed]")
      .trim() || "—"
  )
}

export function PerlicaPage({ params, navigate }: PluginPageProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const token = usePerlicaStore((state) => state.token)
  const accountId = usePerlicaStore((state) => state.accountId)
  const hasHydrated = usePerlicaStore((state) => state.hasHydrated)
  const center = usePerlicaStore((state) => state.center)
  const locationConfirmed = usePerlicaStore((state) => state.locationConfirmed)
  const radius = usePerlicaStore((state) => state.radius)
  const setCenter = usePerlicaStore((state) => state.setCenter)
  const setRadius = usePerlicaStore((state) => state.setRadius)

  const session = useMemo(() => ({ accountId, token }), [accountId, token])
  const client = useMemo(() => (token && accountId ? getPerlicaClient() : null), [accountId, token])
  const activeTab = perlicaTab(params)
  const setActiveTab = useCallback(
    (tab: PerlicaTab) => navigate(PERLICA_PAGE_INDEX, { tab }),
    [navigate]
  )
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualCode, setManualCode] = useState("")
  const [selectedCode, setSelectedCode] = useState("")
  const [listOpen, setListOpen] = useState(false)
  const [machines, setMachines] = useState<PerlicaMachine[]>([])
  const [user, setUser] = useState<PerlicaUserInfo | null>(null)
  const [cards, setCards] = useState<PerlicaRideCard[]>([])
  const [unreadCount, setUnreadCount] = useState<number | null>(null)
  const [order, setOrder] = useState<PerlicaOrder | null>(null)
  const [orderLoaded, setOrderLoaded] = useState(false)
  const [logs, setLogs] = useState<PerlicaRideLog[]>([])
  const [logPage, setLogPage] = useState(1)
  const [hasMoreLogs, setHasMoreLogs] = useState(false)
  const [geoArea, setGeoArea] = useState<PerlicaGeoArea | null>(null)
  const [parkPoints, setParkPoints] = useState<PerlicaParkPoint[]>([])
  const [stations, setStations] = useState<PerlicaStation[]>([])
  const [remandPoints, setRemandPoints] = useState<PerlicaParkPoint[]>([])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapError, setMapError] = useState(false)
  const [accountLoading, setAccountLoading] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [locating, setLocating] = useState(false)

  const initialSessionRef = useRef<typeof session | null>(null)
  const sessionRef = useRef<typeof session | null>(session)
  const mountedRef = useRef(false)
  const nearbyRequestRef = useRef(0)
  const geoRequestRef = useRef(0)
  const pointsRequestRef = useRef(0)
  const logsRequestRef = useRef(0)
  const orderRequestRef = useRef(0)
  const orderRef = useRef(order)
  const mapMoveTimerRef = useRef<number | null>(null)
  const optimisticOrderRef = useRef<{ order: PerlicaOrder; until: number } | null>(null)
  const loadedAtRef = useRef({ machines: 0, user: 0, cards: 0, logs: 0, geo: 0, unread: 0 })
  const isSessionActive = useCallback(
    () => mountedRef.current && sessionRef.current === session,
    [session]
  )

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionRef.current = null
    }
  }, [])

  const reportError = useCallback(
    (error: unknown) => {
      if (!isSessionActive()) return
      toast.error(
        error instanceof PerlicaError
          ? t("perlica.requestFailedRet", { ret: error.ret, message: safeServiceMessage(error) })
          : t("perlica.requestFailed")
      )
    },
    [isSessionActive, t]
  )

  const applyOrder = useCallback(
    (next: PerlicaOrder | null) => {
      if (!isSessionActive()) return
      const optimistic = optimisticOrderRef.current
      if (optimistic) {
        if (!next && Date.now() < optimistic.until) return
        if (next?.orderNo === optimistic.order.orderNo || Date.now() >= optimistic.until) {
          optimisticOrderRef.current = null
        }
      }
      setOrder(next)
      setOrderLoaded(true)
      writePerlicaSnapshot(session.accountId, { order: next, orderAt: Date.now() })
    },
    [isSessionActive, session.accountId]
  )

  const showOptimisticOrder = useCallback(
    (next: PerlicaOrder) => {
      if (!isSessionActive()) return
      optimisticOrderRef.current = { order: next, until: Date.now() + 15_000 }
      setOrder(next)
      setOrderLoaded(true)
      writePerlicaSnapshot(session.accountId, { order: next, orderAt: Date.now() })
      setSelectedCode("")
      setActiveTab("ride")
    },
    [isSessionActive, session.accountId, setActiveTab]
  )

  const loadNearby = useCallback(
    async (force = false, targetCenter = center, targetRadius = radius) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && Date.now() - loadedAtRef.current.machines < MAP_TTL)
      ) {
        return
      }
      const request = ++nearbyRequestRef.current
      setMapLoading(true)
      try {
        const result = await client.nearMachines(targetCenter, targetRadius)
        if (!isSessionActive() || request !== nearbyRequestRef.current) return
        setMachines(result)
        setMapError(false)
        loadedAtRef.current.machines = Date.now()
        writePerlicaSnapshot(session.accountId, {
          machines: result,
          machinesAt: Date.now(),
          center: targetCenter,
        })
      } catch {
        if (isSessionActive() && request === nearbyRequestRef.current) {
          // The inline alert below the map is the recovery affordance for this
          // request; avoid a duplicate transient toast.
          setMapError(true)
        }
      } finally {
        if (isSessionActive() && request === nearbyRequestRef.current) setMapLoading(false)
      }
    },
    [center, client, isSessionActive, radius, session.accountId]
  )

  const loadGeo = useCallback(
    async (force = false, targetCenter = center) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && Date.now() - loadedAtRef.current.geo < GEO_TTL)
      ) {
        return
      }
      const request = ++geoRequestRef.current
      try {
        const result = await client.geoArea(targetCenter)
        if (!isSessionActive() || request !== geoRequestRef.current) return
        setGeoArea(result)
        loadedAtRef.current.geo = Date.now()
        writePerlicaSnapshot(session.accountId, { geoArea: result, geoAreaAt: Date.now() })
      } catch (error) {
        if (isSessionActive() && request === geoRequestRef.current) reportError(error)
      }
    },
    [center, client, isSessionActive, reportError, session.accountId]
  )

  const loadMapPoints = useCallback(
    async (targetCenter = center, targetRadius = radius) => {
      if (!client || !isSessionActive()) return
      const request = ++pointsRequestRef.current
      const [parkResult, stationResult] = await Promise.allSettled([
        client.parkPoints(targetCenter, targetRadius),
        client.stations(targetCenter),
      ])
      if (!isSessionActive() || request !== pointsRequestRef.current) return
      if (parkResult.status === "fulfilled") setParkPoints(parkResult.value)
      else reportError(parkResult.reason)
      if (stationResult.status === "fulfilled") setStations(stationResult.value)
      else reportError(stationResult.reason)
    },
    [center, client, isSessionActive, radius, reportError]
  )

  const loadUser = useCallback(
    async (force = false) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && Date.now() - loadedAtRef.current.user < ACCOUNT_TTL)
      ) {
        return
      }
      try {
        const result = await client.userInfo()
        if (!isSessionActive()) return
        setUser(result)
        loadedAtRef.current.user = Date.now()
        writePerlicaSnapshot(session.accountId, { user: result, userAt: Date.now() })
      } catch (error) {
        if (isSessionActive()) reportError(error)
      }
    },
    [client, isSessionActive, reportError, session.accountId]
  )

  const loadCards = useCallback(
    async (force = false, targetCenter = center) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && Date.now() - loadedAtRef.current.cards < ACCOUNT_TTL)
      ) {
        return
      }
      try {
        const result = await client.rideCards(targetCenter)
        if (!isSessionActive()) return
        setCards(result)
        loadedAtRef.current.cards = Date.now()
        writePerlicaSnapshot(session.accountId, { cards: result, cardsAt: Date.now() })
      } catch (error) {
        if (isSessionActive()) reportError(error)
      }
    },
    [center, client, isSessionActive, reportError, session.accountId]
  )

  const refreshMapAt = useCallback(
    async (coords: PerlicaCoords, nextRadius: number) => {
      await Promise.all([
        loadNearby(true, coords, nextRadius),
        loadGeo(true, coords),
        loadMapPoints(coords, nextRadius),
        loadCards(true, coords),
      ])
    },
    [loadCards, loadGeo, loadMapPoints, loadNearby]
  )

  const loadUnread = useCallback(
    async (force = false) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && Date.now() - loadedAtRef.current.unread < MAP_TTL)
      ) {
        return
      }
      try {
        const result = await client.unreadCount()
        if (!isSessionActive()) return
        setUnreadCount(result)
        loadedAtRef.current.unread = Date.now()
      } catch (error) {
        if (isSessionActive()) reportError(error)
      }
    },
    [client, isSessionActive, reportError]
  )

  const loadAccount = useCallback(
    async (force = false) => {
      if (!isSessionActive()) return
      setAccountLoading(true)
      await Promise.all([loadUser(force), loadCards(force), loadUnread(force)])
      if (isSessionActive()) setAccountLoading(false)
    },
    [isSessionActive, loadCards, loadUnread, loadUser]
  )

  const loadOrder = useCallback(async () => {
    if (!client || !isSessionActive()) return null
    const request = ++orderRequestRef.current
    setOrderLoading(true)
    try {
      const result = await client.currentOrder()
      if (!isSessionActive()) return null
      if (request === orderRequestRef.current) applyOrder(result)
      return result
    } catch (error) {
      if (isSessionActive() && request === orderRequestRef.current) reportError(error)
      return null
    } finally {
      if (isSessionActive() && request === orderRequestRef.current) setOrderLoading(false)
    }
  }, [applyOrder, client, isSessionActive, reportError])

  useEffect(() => {
    orderRef.current = order
  }, [order])

  useEffect(() => {
    const currentOrder = orderRef.current
    if (!currentOrder || optimisticOrderRef.current?.order.orderNo !== currentOrder.orderNo) {
      return
    }
    const timers = [700, 1500].map((delay) => window.setTimeout(() => void loadOrder(), delay))
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [loadOrder, order?.orderNo])

  const loadLogs = useCallback(
    async (page = 1, append = false, force = false) => {
      if (
        !client ||
        !isSessionActive() ||
        (!force && page === 1 && Date.now() - loadedAtRef.current.logs < ACCOUNT_TTL)
      ) {
        return
      }
      const request = ++logsRequestRef.current
      setLogsLoading(true)
      try {
        const result = await client.rideLogs(page, PAGE_SIZE)
        if (!isSessionActive() || request !== logsRequestRef.current) return
        setLogs((previous) => {
          if (!isSessionActive()) return previous
          const next = append ? [...previous, ...result] : result
          writePerlicaSnapshot(session.accountId, { logs: next, logsAt: Date.now() })
          return next
        })
        setLogPage(page)
        setHasMoreLogs(result.length === PAGE_SIZE)
        loadedAtRef.current.logs = Date.now()
      } catch (error) {
        if (isSessionActive() && request === logsRequestRef.current) reportError(error)
      } finally {
        if (isSessionActive() && request === logsRequestRef.current) setLogsLoading(false)
      }
    },
    [client, isSessionActive, reportError, session.accountId]
  )

  const refreshAll = useCallback(async () => {
    await Promise.all([
      loadNearby(true),
      loadGeo(true),
      loadMapPoints(),
      loadAccount(true),
      loadOrder(),
      loadLogs(1, false, true),
    ])
  }, [loadAccount, loadGeo, loadLogs, loadMapPoints, loadNearby, loadOrder])

  useEffect(() => {
    if (!hasHydrated || !isSessionActive()) return
    if (!client) {
      initialSessionRef.current = null
      return
    }
    if (initialSessionRef.current === session) return
    initialSessionRef.current = session
    optimisticOrderRef.current = null
    setMachines([])
    setUser(null)
    setOrder(null)
    setOrderLoaded(false)
    setLogs([])
    setCards([])
    setUnreadCount(null)
    setGeoArea(null)
    setParkPoints([])
    setStations([])
    setRemandPoints([])
    setMapLoading(false)
    setMapError(false)
    setAccountLoading(false)
    setOrderLoading(false)
    setLogsLoading(false)
    setLocating(false)
    loadedAtRef.current = { machines: 0, user: 0, cards: 0, logs: 0, geo: 0, unread: 0 }

    const snapshot = readPerlicaSnapshot(session.accountId)
    if (snapshot) {
      setMachines(snapshot.machines)
      setUser(snapshot.user)
      setOrder(snapshot.order)
      setOrderLoaded(snapshot.orderAt > 0)
      setLogs(snapshot.logs)
      setCards(snapshot.cards)
      setGeoArea(snapshot.geoArea)
      loadedAtRef.current = {
        machines: snapshot.machinesAt,
        user: snapshot.userAt,
        cards: snapshot.cardsAt,
        logs: snapshot.logsAt,
        geo: snapshot.geoAreaAt,
        unread: 0,
      }
    }
    void Promise.all([
      loadNearby(true),
      loadGeo(true),
      loadMapPoints(),
      loadAccount(true),
      loadOrder(),
      loadLogs(1, false, true),
      client
        .remandPoints()
        .then((result) => {
          if (isSessionActive()) setRemandPoints(result)
        })
        .catch((error) => {
          if (isSessionActive()) reportError(error)
        }),
    ])
  }, [
    client,
    hasHydrated,
    isSessionActive,
    loadAccount,
    loadGeo,
    loadLogs,
    loadMapPoints,
    loadNearby,
    loadOrder,
    reportError,
    session,
  ])

  useEffect(() => {
    const deepLinkedCode = parsePerlicaCode(params.toString())
    if (deepLinkedCode && /^\d{8,9}$/.test(deepLinkedCode)) {
      setSelectedCode(deepLinkedCode)
      setManualCode(deepLinkedCode)
      if (activeTab !== "map") setActiveTab("map")
    }
    // Deep links are delivered once per mount through the plugin page params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () => () => {
      clearTimeout(mapMoveTimerRef.current ?? undefined)
    },
    []
  )

  const requestLocation = useCallback(
    async (refreshMap = false) => {
      if (locating || !isSessionActive()) return null
      setLocating(true)
      try {
        // The host exports the Capacitor Geolocation bridge so plugins do not
        // depend on native packages directly.
        const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true })
        if (!isSessionActive()) return null
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude }
        setCenter(coords)
        if (refreshMap) toast.success(t("perlica.locationUpdated"))
        return coords
      } catch {
        if (isSessionActive()) toast.error(t("perlica.locationFailed"))
        return null
      } finally {
        if (isSessionActive()) setLocating(false)
      }
    },
    [isSessionActive, locating, setCenter, t]
  )

  const handleCenterSelect = useCallback(
    (coords: PerlicaCoords) => {
      if (!isSessionActive()) return
      setCenter(coords)
      clearTimeout(mapMoveTimerRef.current ?? undefined)
      mapMoveTimerRef.current = window.setTimeout(() => {
        void refreshMapAt(coords, radius)
      }, 450)
    },
    [isSessionActive, radius, refreshMapAt, setCenter]
  )

  const selectCode = useCallback(
    (code: string) => {
      if (!/^\d{8,9}$/.test(code)) {
        toast.error(t("perlica.invalidBikeCode"))
        return
      }
      setSelectedCode(code)
      setManualCode(code)
      setActiveTab("map")
    },
    [setActiveTab, t]
  )

  const refreshing = mapLoading || accountLoading || orderLoading || logsLoading

  const selectAppTab = useCallback(
    (value: string) => {
      if (!isPerlicaTab(value)) return
      setActiveTab(value)
    },
    [setActiveTab]
  )

  useMobileHeaderRight(
    <div className="flex items-center gap-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => void refreshAll()}
        disabled={refreshing}
        aria-label={t("perlica.refresh")}
      >
        <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => navigate(PERLICA_PAGE_SETTINGS, { tab: activeTab })}
        aria-label={t("perlica.settingsTitle")}
      >
        <Settings className="size-4" />
      </Button>
    </div>,
    [activeTab, navigate, refreshAll, refreshing, t]
  )

  const mapMachines = useMemo(
    () =>
      machines.map((machine) => ({
        machineNO: machine.machineNo || machine.userCode,
        userCode: machine.userCode,
        lat: machine.lat,
        lon: machine.lng,
        socPercent: machine.battery,
        surplusMileage:
          Number(machine.raw.surplusMileage ?? machine.raw.remainingMileage) || undefined,
        posDt:
          typeof machine.raw.posDt === "string" || typeof machine.raw.posDt === "number"
            ? machine.raw.posDt
            : undefined,
      })),
    [machines]
  )
  const geoPoints = useMemo(
    () => geoArea?.pointList.map((point) => ({ lat: point.y, lng: point.x })) ?? [],
    [geoArea]
  )
  const selectedMachine = useMemo(
    () =>
      machines.find(
        (machine) => machine.userCode === selectedCode || machine.machineNo === selectedCode
      ) ?? null,
    [machines, selectedCode]
  )

  if (!hasHydrated) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    )
  }

  if (!token || !client) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bike />
            </EmptyMedia>
            <EmptyTitle>{t("perlica.noToken")}</EmptyTitle>
            <EmptyDescription>{t("perlica.noTokenHint")}</EmptyDescription>
          </EmptyHeader>
          <Button asChild>
            <Link href={pluginPageHref(PERLICA_PLUGIN_ID, PERLICA_PAGE_SETTINGS)}>
              {t("perlica.goSettings")}
            </Link>
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex flex-col",
        activeTab === "map" ? "min-h-0 flex-1 max-md:-m-4 md:-m-8" : "gap-4 p-4"
      )}
    >
      <Tabs
        value={activeTab}
        onValueChange={selectAppTab}
        className={cn("flex flex-col", activeTab === "map" ? "min-h-0 flex-1 gap-0" : "gap-4")}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 max-sm:hidden">
          <TabsList aria-label={t("perlica.nav")} className="w-full justify-start sm:w-auto">
            <TabsTrigger value="map">{t("perlica.tabMap")}</TabsTrigger>
            <TabsTrigger value="ride">{t("perlica.tabRide")}</TabsTrigger>
            <TabsTrigger value="history">{t("perlica.tabHistory")}</TabsTrigger>
            <TabsTrigger value="account">{t("perlica.tabAccount")}</TabsTrigger>
          </TabsList>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            <RefreshCw data-icon="inline-start" className={cn(refreshing && "animate-spin")} />
            {t("perlica.refresh")}
          </Button>
        </div>

        <TabsContent
          value="map"
          id="perlica-panel-map"
          forceMount
          className="m-0 min-h-0 flex-1 data-[state=inactive]:hidden"
        >
          <div className="relative h-full min-h-0 overflow-hidden bg-card">
            <PerlicaMap
              className="absolute inset-0 h-full w-full"
              showBadge={false}
              showLegend={false}
              showZoomControl={false}
              center={center}
              machines={mapMachines}
              radius={radius}
              geoPoints={geoPoints}
              parkPoints={parkPoints}
              stations={stations}
              remandPoints={remandPoints}
              selectedMachineNO={selectedMachine?.machineNo || undefined}
              onSelect={handleCenterSelect}
              onSelectMachine={(machineNo) => {
                const machine = machines.find(
                  (item) => item.machineNo === machineNo || item.userCode === machineNo
                )
                if (machine) selectCode(machine.userCode || machine.machineNo)
              }}
            />

            <form
              className="absolute inset-x-3 top-3 z-20 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                selectCode(manualCode.trim())
              }}
            >
              <div className="relative flex-1 overflow-hidden rounded-lg border bg-background shadow-sm">
                <InputGroup className="h-11 rounded-lg border-0 bg-transparent shadow-none has-disabled:bg-transparent has-disabled:opacity-100 dark:bg-transparent">
                  <InputGroupAddon>
                    <Search className="size-4" />
                  </InputGroupAddon>
                  <InputGroupInput
                    value={manualCode}
                    onChange={(event) =>
                      setManualCode(event.target.value.replace(/\D/g, "").slice(0, 9))
                    }
                    placeholder={t("perlica.manualPlaceholder")}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={t("perlica.manualPlaceholder")}
                  />
                  {manualCode ? (
                    <InputGroupButton
                      type="button"
                      size="icon-xs"
                      onClick={() => setManualCode("")}
                      aria-label={t("perlica.clearCode")}
                    >
                      <X className="size-4" />
                    </InputGroupButton>
                  ) : null}
                  <InputGroupButton
                    type="submit"
                    size="icon-sm"
                    className="mr-1.5"
                    disabled={!/^\d{8,9}$/.test(manualCode)}
                    aria-label={t("perlica.queryMachine")}
                  >
                    <ArrowRight className="size-4" />
                  </InputGroupButton>
                </InputGroup>
              </div>
              {order ? (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="relative size-11 shrink-0 rounded-full shadow-sm"
                  onClick={() => selectAppTab("ride")}
                  aria-label={t("perlica.activeRideTitle")}
                  title={t("perlica.activeRideTitle")}
                >
                  <Bike className="size-5" />
                  <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
                </Button>
              ) : null}
            </form>

            <ToggleGroup
              type="single"
              value={String(radius)}
              onValueChange={(value) => {
                if (!value) return
                const next = Number(value)
                setRadius(next)
                void refreshMapAt(center, next)
              }}
              aria-label={t("perlica.searchRadius")}
              className="absolute inset-x-3 top-[4.5rem] z-20 grid w-auto grid-cols-5 rounded-lg border bg-background p-1 shadow-sm"
            >
              {RADII.map((value) => (
                <ToggleGroupItem
                  key={value}
                  value={String(value)}
                  className="h-8 rounded-md px-0 text-xs data-[state=on]:bg-muted"
                >
                  {formatRadius(value)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setListOpen(true)}
              className="absolute bottom-3 left-3 z-20 h-10 max-w-[62%] rounded-full px-3 shadow-sm"
            >
              {mapLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : mapError ? (
                <TriangleAlert className="size-4 text-destructive" />
              ) : (
                <Bike className="size-4" />
              )}
              <span className="truncate">
                {mapError
                  ? t("perlica.nearbyFailedShort")
                  : t("perlica.machineCount", { count: machines.length })}
              </span>
              <ChevronUp className="size-4 opacity-60" />
            </Button>

            <div className="absolute right-3 bottom-3 z-20 flex flex-col gap-2">
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => {
                  void requestLocation(true).then((coords) => {
                    if (coords) void refreshMapAt(coords, radius)
                  })
                }}
                disabled={locating}
                aria-label={locating ? t("perlica.locating") : t("perlica.locate")}
                title={locating ? t("perlica.locating") : t("perlica.locate")}
                className="size-11 rounded-full shadow-sm"
              >
                {locating ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <LocateFixed className="size-5" />
                )}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                onClick={() => setScannerOpen(true)}
                aria-label={t("perlica.scanCode")}
                title={t("perlica.scanCode")}
                className="size-11 rounded-full shadow-sm"
              >
                <ScanLine className="size-5" />
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="ride"
          id="perlica-panel-ride"
          forceMount
          className="m-0 data-[state=inactive]:hidden"
        >
          <div className="flex flex-col gap-4">
            {order ? (
              <PerlicaActiveRide
                key={session.token}
                client={client}
                order={order}
                onOrderChange={applyOrder}
                onRequestLocation={() => requestLocation(false)}
                reportError={reportError}
              />
            ) : (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {orderLoading ? <Loader2 className="animate-spin" /> : <Bike />}
                  </EmptyMedia>
                  <EmptyTitle>
                    {orderLoaded ? t("perlica.noCurrentOrder") : t("perlica.notLoaded")}
                  </EmptyTitle>
                  <EmptyDescription>{t("perlica.noActiveRideHint")}</EmptyDescription>
                </EmptyHeader>
                <Button type="button" variant="outline" onClick={() => selectAppTab("map")}>
                  {t("perlica.tabMap")}
                </Button>
              </Empty>
            )}
          </div>
        </TabsContent>

        <TabsContent
          value="history"
          id="perlica-panel-history"
          forceMount
          className="m-0 data-[state=inactive]:hidden"
        >
          <PerlicaHistory
            key={session.token}
            client={client}
            coords={center}
            logs={logs}
            loading={logsLoading}
            hasMore={hasMoreLogs}
            onLoadMore={() => void loadLogs(logPage + 1, true, true)}
            reportError={reportError}
          />
        </TabsContent>

        <TabsContent
          value="account"
          id="perlica-panel-account"
          forceMount
          className="m-0 data-[state=inactive]:hidden"
        >
          <PerlicaAccount
            user={user}
            cards={cards}
            unreadCount={unreadCount}
            loading={accountLoading}
          />
        </TabsContent>
      </Tabs>

      <Sheet open={listOpen} onOpenChange={setListOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[70dvh] gap-0 overflow-y-auto p-0"
        >
          <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 border-b bg-background px-4 py-3">
            <div className="min-w-0">
              <SheetTitle>{t("perlica.nearbyMachines")}</SheetTitle>
              <SheetDescription>
                {t("perlica.machineCount", { count: machines.length })}
              </SheetDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => void loadNearby(true)}
                disabled={mapLoading}
                aria-label={t("perlica.refresh")}
              >
                <RefreshCw className={cn("size-4", mapLoading && "animate-spin")} />
              </Button>
              <SheetClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("perlica.close")}
                >
                  <X className="size-4" />
                </Button>
              </SheetClose>
            </div>
          </SheetHeader>

          {mapError ? (
            <div className="border-b px-4 py-4">
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{t("perlica.nearbyFailed")}</AlertTitle>
                <AlertDescription>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={mapLoading}
                    onClick={() => void loadNearby(true)}
                  >
                    {t("perlica.retry")}
                  </Button>
                </AlertDescription>
              </Alert>
            </div>
          ) : null}

          {machines.length > 0 || mapLoading ? (
            <PerlicaNearbyList
              machines={machines}
              selectedCode={selectedCode}
              loading={mapLoading}
              onSelect={(code) => {
                setListOpen(false)
                selectCode(code)
              }}
            />
          ) : mapError ? null : (
            <Empty className="rounded-none border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Bike />
                </EmptyMedia>
                <EmptyTitle>{t("perlica.noNearby")}</EmptyTitle>
                <EmptyDescription>{t("perlica.noNearbyHint")}</EmptyDescription>
              </EmptyHeader>
              <Button
                type="button"
                variant="outline"
                disabled={locating}
                onClick={() => {
                  if (radius >= 10000) {
                    void requestLocation(true)
                    return
                  }
                  const next = Math.min(10000, Math.max(radius * 2, 1000))
                  setRadius(next)
                  void refreshMapAt(center, next)
                }}
              >
                {radius >= 10000
                  ? locating
                    ? t("perlica.locating")
                    : t("perlica.locate")
                  : t("perlica.expandRadius")}
              </Button>
            </Empty>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(selectedCode)}
        onOpenChange={(open) => {
          if (!open) setSelectedCode("")
        }}
      >
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[92dvh] gap-0 overflow-y-auto p-0"
        >
          <SheetHeader className="sticky top-0 z-10 flex-row items-center justify-between gap-3 border-b bg-background px-4 py-3">
            <div className="min-w-0">
              <SheetTitle className="truncate">{t("perlica.machineDetails")}</SheetTitle>
              <SheetDescription className="truncate">{selectedCode}</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("perlica.close")}>
                <X className="size-4" />
              </Button>
            </SheetClose>
          </SheetHeader>
          <PerlicaMachineDetail
            key={session.token}
            client={client}
            code={selectedCode}
            machine={selectedMachine}
            coords={center}
            locationConfirmed={locationConfirmed}
            currentOrder={order}
            onOrderChange={applyOrder}
            onBorrowSuccess={showOptimisticOrder}
            onRequestLocation={() => requestLocation(false)}
            onShowOrder={() => {
              setSelectedCode("")
              setActiveTab("ride")
            }}
            reportError={reportError}
          />
        </SheetContent>
      </Sheet>

      <PerlicaScanner open={scannerOpen} onOpenChange={setScannerOpen} onCode={selectCode} />
    </div>
  )
}
