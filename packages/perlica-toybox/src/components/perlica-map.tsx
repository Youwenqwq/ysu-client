"use client"

import { useEffect, useRef, useState } from "react"
import type { Circle, CircleMarker, DivIcon, Map as LeafletMap, Marker, Polygon } from "leaflet"
import { gcj02ToWgs84, isUsableLatLng, wgs84ToGcj02 } from "../extras/geo"
import { usePluginTranslation } from "@ysu/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { cn } from "@ysu/plugin-ui/components"
import { addAmapTileLayer, type Leaflet } from "./perlica-map-tiles"

export interface PerlicaMapCenter {
  lat: number
  lng: number
}

export interface PerlicaMapMachine {
  machineNO: string
  userCode?: string
  lat: number
  lon: number
  socPercent?: number
  surplusMileage?: number
  /** Last reported position time, as an ISO/date string or Unix seconds/milliseconds. */
  posDt?: string | number
}

export interface PerlicaMapPoint {
  id?: string
  name?: string
  address?: string
  lat: number
  lng: number
}

export interface PerlicaMapProps {
  center: PerlicaMapCenter
  machines: PerlicaMapMachine[]
  selectedMachineNO?: string
  radius?: number
  geoPoints?: Array<{ lat: number; lng: number }>
  parkPoints?: PerlicaMapPoint[]
  stations?: PerlicaMapPoint[]
  remandPoints?: PerlicaMapPoint[]
  className?: string
  showBadge?: boolean
  showLegend?: boolean
  showZoomControl?: boolean
  onSelect: (center: PerlicaMapCenter) => void
  onSelectMachine: (machineNO: string) => void
}

type PointKind = "park" | "station" | "remand"

const SELECT_DEBOUNCE_MS = 320
const STALE_POSITION_MS = 6 * 60 * 60 * 1000
const POINT_PANE_Z_INDEX = "450"

const POINT_STYLES: Record<PointKind, { color: string; label: string; zIndex: number }> = {
  park: { color: "#0ea5e9", label: "P", zIndex: 200 },
  station: { color: "#8b5cf6", label: "S", zIndex: 300 },
  remand: { color: "#f59e0b", label: "R", zIndex: 150 },
}

function createPointIcon(L: Leaflet, kind: PointKind): DivIcon {
  const style = POINT_STYLES[kind]
  return L.divIcon({
    className: "perlica-point-marker",
    html: `<div style="box-sizing:border-box;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:${style.color};border:2px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.4);color:#fff;font:700 11px/1 system-ui,sans-serif">${style.label}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

function machineColor(socPercent: number | undefined, stale: boolean): string {
  if (stale) return "#6b7280"
  if (socPercent === undefined || !Number.isFinite(socPercent)) return "#64748b"
  if (socPercent >= 60) return "#16a34a"
  if (socPercent >= 25) return "#f59e0b"
  return "#ef4444"
}

function machineTitle(machine: PerlicaMapMachine): string {
  const details = [machine.machineNO]
  if (machine.socPercent !== undefined) {
    details.push(`${Math.round(machine.socPercent)}%`)
  }
  if (machine.surplusMileage !== undefined) {
    details.push(`${machine.surplusMileage} km`)
  }
  return details.join(" · ")
}

function pointTitle(point: PerlicaMapPoint): string {
  const text = [point.name, point.address].filter(Boolean).join(" · ")
  return text || `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
}

function pointKey(point: PerlicaMapPoint): string {
  return (
    point.id ||
    `${point.lat.toFixed(6)},${point.lng.toFixed(6)},${point.name ?? ""},${point.address ?? ""}`
  )
}

function updateTooltip(layer: Marker | CircleMarker, title: string) {
  if (layer.getTooltip()) {
    layer.setTooltipContent(title)
  } else {
    layer.bindTooltip(title, { direction: "top", offset: [0, -10] })
  }
}

function hasStalePosition(posDt: string | number | undefined, now: number): boolean {
  if (posDt === undefined || posDt === null || posDt === "") return false

  let timestamp = Number.NaN
  if (typeof posDt === "number" || posDt.trim() !== "") {
    const numeric = Number(posDt)
    if (Number.isFinite(numeric)) {
      timestamp = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
    }
  }
  if (!Number.isFinite(timestamp) && typeof posDt === "string") {
    timestamp = Date.parse(posDt.replace(" ", "T"))
  }

  return Number.isFinite(timestamp) && now - timestamp > STALE_POSITION_MS
}

function countUsablePoints(points: PerlicaMapPoint[] | undefined): number {
  return (points ?? []).filter((point) => isUsableLatLng(point.lat, point.lng)).length
}

function syncPointMarkers(
  L: Leaflet,
  map: LeafletMap,
  points: PerlicaMapPoint[] | undefined,
  kind: PointKind,
  markers: Map<string, Marker>
) {
  const nextKeys = new Set<string>()

  for (const point of points ?? []) {
    if (!isUsableLatLng(point.lat, point.lng)) continue
    const key = pointKey(point)
    nextKeys.add(key)

    const projected = wgs84ToGcj02(point.lat, point.lng)
    const position: [number, number] = [projected.lat, projected.lng]
    const title = pointTitle(point)
    const existing = markers.get(key)

    if (existing) {
      existing.setLatLng(position)
      updateTooltip(existing, title)
      continue
    }

    const marker = L.marker(position, {
      alt: title,
      bubblingMouseEvents: false,
      icon: createPointIcon(L, kind),
      keyboard: true,
      pane: "perlicaPointPane",
      title,
      zIndexOffset: POINT_STYLES[kind].zIndex,
    }).addTo(map)
    updateTooltip(marker, title)
    markers.set(key, marker)
  }

  for (const [key, marker] of markers) {
    if (!nextKeys.has(key)) {
      marker.remove()
      markers.delete(key)
    }
  }
}

export function PerlicaMap({
  center,
  machines,
  selectedMachineNO,
  radius,
  geoPoints,
  parkPoints,
  stations,
  remandPoints,
  className,
  showBadge = true,
  showLegend = true,
  showZoomControl = true,
  onSelect,
  onSelectMachine,
}: PerlicaMapProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialCenterRef = useRef(center)
  const machineMarkersRef = useRef<Map<string, CircleMarker>>(new Map())
  const parkMarkersRef = useRef<Map<string, Marker>>(new Map())
  const stationMarkersRef = useRef<Map<string, Marker>>(new Map())
  const remandMarkersRef = useRef<Map<string, Marker>>(new Map())
  const radiusCircleRef = useRef<Circle | null>(null)
  const geoPolygonRef = useRef<Polygon | null>(null)
  const leafletRef = useRef<Leaflet | null>(null)
  const onSelectRef = useRef(onSelect)
  const onSelectMachineRef = useRef(onSelectMachine)
  const selectTimerRef = useRef<number | null>(null)
  const programmaticMoveRef = useRef(false)
  const programmaticMoveTimerRef = useRef<number | null>(null)
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    onSelectRef.current = onSelect
    onSelectMachineRef.current = onSelectMachine
  }, [onSelect, onSelectMachine])

  useEffect(() => {
    const machineMarkers = machineMarkersRef.current
    const parkMarkers = parkMarkersRef.current
    const stationMarkers = stationMarkersRef.current
    const remandMarkers = remandMarkersRef.current
    let disposed = false
    let map: LeafletMap | null = null
    let selectTimer: number | null = null

    async function initializeMap() {
      try {
        // Leaflet accesses browser globals, so it must load after client mount.
        const L = await import("leaflet")
        const container = containerRef.current
        if (disposed || !container) return

        const initialCenter = initialCenterRef.current
        const initialPosition = wgs84ToGcj02(initialCenter.lat, initialCenter.lng)
        map = L.map(container, {
          center: [initialPosition.lat, initialPosition.lng],
          zoom: 16,
          zoomControl: false,
          attributionControl: false,
        })
        addAmapTileLayer(L, map)
        if (showZoomControl) L.control.zoom({ position: "topright" }).addTo(map)

        const pointPane = map.createPane("perlicaPointPane")
        pointPane.style.zIndex = POINT_PANE_Z_INDEX

        const scheduleSelect = (nextCenter: PerlicaMapCenter) => {
          if (selectTimer !== null) window.clearTimeout(selectTimer)
          selectTimer = window.setTimeout(() => {
            selectTimer = null
            onSelectRef.current(nextCenter)
          }, SELECT_DEBOUNCE_MS)
        }

        map.on("click", (event) => {
          if (!map) return
          map.setView(event.latlng, map.getZoom(), { animate: true })
          scheduleSelect(gcj02ToWgs84(event.latlng.lat, event.latlng.lng))
        })

        map.on("moveend", () => {
          if (!map || programmaticMoveRef.current) return
          const position = map.getCenter()
          scheduleSelect(gcj02ToWgs84(position.lat, position.lng))
        })

        leafletRef.current = L
        setMapInstance(map)
      } catch {
        if (!disposed) setLoadFailed(true)
      }
    }

    void initializeMap()

    return () => {
      disposed = true
      if (selectTimer !== null) window.clearTimeout(selectTimer)
      selectTimerRef.current = null
      if (programmaticMoveTimerRef.current !== null) {
        window.clearTimeout(programmaticMoveTimerRef.current)
        programmaticMoveTimerRef.current = null
      }
      programmaticMoveRef.current = false
      radiusCircleRef.current = null
      geoPolygonRef.current = null
      machineMarkers.clear()
      parkMarkers.clear()
      stationMarkers.clear()
      remandMarkers.clear()
      leafletRef.current = null
      map?.remove()
    }
  }, [showZoomControl])

  useEffect(() => {
    if (selectTimerRef.current !== null) {
      window.clearTimeout(selectTimerRef.current)
      selectTimerRef.current = null
    }
  }, [center.lat, center.lng])

  useEffect(() => {
    if (!mapInstance) return

    const projected = wgs84ToGcj02(center.lat, center.lng)
    if (!isUsableLatLng(projected.lat, projected.lng)) return

    const current = mapInstance.getCenter()
    if (
      Math.abs(current.lat - projected.lat) < 1e-7 &&
      Math.abs(current.lng - projected.lng) < 1e-7
    ) {
      return
    }

    programmaticMoveRef.current = true
    mapInstance.setView([projected.lat, projected.lng], mapInstance.getZoom(), {
      animate: false,
    })
    if (programmaticMoveTimerRef.current !== null) {
      window.clearTimeout(programmaticMoveTimerRef.current)
    }
    programmaticMoveTimerRef.current = window.setTimeout(() => {
      programmaticMoveRef.current = false
      programmaticMoveTimerRef.current = null
    }, 400)
  }, [center.lat, center.lng, mapInstance])

  useEffect(() => {
    if (!mapInstance) return
    const container = containerRef.current
    if (!container) return
    // Tab panels stay mounted so section state survives; Leaflet must remeasure
    // when a hidden panel becomes visible again.
    const observer = new ResizeObserver(() => mapInstance.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [mapInstance])

  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance || !L) return

    const projected = wgs84ToGcj02(center.lat, center.lng)
    const position: [number, number] = [projected.lat, projected.lng]
    const validRadius = radius !== undefined && Number.isFinite(radius) && radius > 0
    let circle = radiusCircleRef.current

    if (!validRadius) {
      circle?.remove()
      radiusCircleRef.current = null
      return
    }

    if (!circle) {
      circle = L.circle(position, {
        radius,
        color: "#16a34a",
        fillColor: "#22c55e",
        fillOpacity: 0.06,
        interactive: false,
        opacity: 0.55,
        weight: 1,
      }).addTo(mapInstance)
      radiusCircleRef.current = circle
      return
    }

    circle.setLatLng(position)
    circle.setRadius(radius)
  }, [center.lat, center.lng, mapInstance, radius])

  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance || !L) return

    const points = (geoPoints ?? [])
      .filter((point) => isUsableLatLng(point.lat, point.lng))
      .map((point) => {
        const projected = wgs84ToGcj02(point.lat, point.lng)
        return [projected.lat, projected.lng] as [number, number]
      })
    let polygon = geoPolygonRef.current

    if (points.length < 3) {
      polygon?.remove()
      geoPolygonRef.current = null
      return
    }

    if (!polygon) {
      polygon = L.polygon(points, {
        color: "#16a34a",
        dashArray: "7,5",
        fillColor: "#22c55e",
        fillOpacity: 0.06,
        interactive: false,
        opacity: 0.75,
        weight: 1.5,
      }).addTo(mapInstance)
      geoPolygonRef.current = polygon
      return
    }

    polygon.setLatLngs(points)
  }, [geoPoints, mapInstance])

  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance || !L) return

    syncPointMarkers(L, mapInstance, parkPoints, "park", parkMarkersRef.current)
    syncPointMarkers(L, mapInstance, stations, "station", stationMarkersRef.current)
    syncPointMarkers(L, mapInstance, remandPoints, "remand", remandMarkersRef.current)
  }, [mapInstance, parkPoints, remandPoints, stations])

  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance || !L) return

    const markers = machineMarkersRef.current
    const nextMachineNumbers = new Set<string>()
    const now = Date.now()

    for (const machine of machines) {
      if (!isUsableLatLng(machine.lat, machine.lon)) continue
      const key = machine.machineNO || machine.userCode
      if (!key) continue
      nextMachineNumbers.add(key)

      const projected = wgs84ToGcj02(machine.lat, machine.lon)
      const position: [number, number] = [projected.lat, projected.lng]
      const selected = machine.machineNO === selectedMachineNO
      const stale = hasStalePosition(machine.posDt, now)
      const fillColor = machineColor(machine.socPercent, stale)
      const markerRadius = selected ? 9 : 6
      const lineColor = selected ? "#0f172a" : "#ffffff"
      const title = machineTitle(machine)
      let marker = markers.get(key)

      if (marker) {
        marker.setLatLng(position)
        marker.setStyle({
          color: lineColor,
          fillColor,
          fillOpacity: 1,
          weight: selected ? 3 : 2,
        })
        marker.setRadius(markerRadius)
      } else {
        marker = L.circleMarker(position, {
          bubblingMouseEvents: false,
          color: lineColor,
          fillColor,
          fillOpacity: 1,
          pane: "markerPane",
          radius: markerRadius,
          weight: selected ? 3 : 2,
        }).addTo(mapInstance)
        marker.on("click", () => {
          onSelectMachineRef.current(key)
        })
        markers.set(key, marker)
      }

      updateTooltip(marker, title)
    }

    for (const [key, marker] of markers) {
      if (!nextMachineNumbers.has(key)) {
        marker.remove()
        markers.delete(key)
      }
    }
  }, [machines, mapInstance, selectedMachineNO])

  const parkCount = countUsablePoints(parkPoints)
  const stationCount = countUsablePoints(stations)
  const remandCount = countUsablePoints(remandPoints)
  const hasArea =
    (geoPoints ?? []).filter((point) => isUsableLatLng(point.lat, point.lng)).length >= 3
  const legendAvailable = hasArea || parkCount + stationCount + remandCount > 0

  return (
    <div
      className={cn(
        "relative isolate z-0 h-[360px] w-full overflow-hidden bg-background",
        className
      )}
    >
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label={t("perlica.mapAriaLabel")}
      />

      <div className="pointer-events-none absolute inset-0 z-[900]" aria-hidden="true">
        <svg
          className="absolute bottom-1/2 left-1/2 -translate-x-1/2 drop-shadow-md"
          width="30"
          height="40"
          viewBox="0 0 30 40"
        >
          <path
            d="M15 38.2C15 38.2 2.6 24.4 2.6 14.2A12.4 12.4 0 0 1 27.4 14.2C27.4 24.4 15 38.2 15 38.2Z"
            fill="#16a34a"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="15" cy="14.2" r="4.6" fill="#ffffff" />
        </svg>
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-600" />
      </div>

      {showBadge ? (
        <div className="pointer-events-none absolute top-2 left-2 z-[1000] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg bg-background/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-md">
          <span>{t("perlica.machineCount", { count: machines.length })}</span>
          <span className="opacity-60">·</span>
          <span>{t("perlica.mapDragHint")}</span>
        </div>
      ) : null}

      {showLegend && legendAvailable ? (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[1000] flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-md">
          {hasArea ? (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm border border-dashed border-emerald-600 bg-emerald-500/10" />
              {t("perlica.mapLegendArea")}
            </span>
          ) : null}
          {parkCount > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="flex size-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white">
                P
              </span>
              {t("perlica.parkPoints")} {parkCount}
            </span>
          ) : null}
          {stationCount > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="flex size-3.5 items-center justify-center rounded-full bg-violet-500 text-[8px] font-bold text-white">
                S
              </span>
              {t("perlica.stations")} {stationCount}
            </span>
          ) : null}
          {remandCount > 0 ? (
            <span className="flex items-center gap-1.5">
              <span className="flex size-3.5 items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                R
              </span>
              {t("perlica.remandPoints")} {remandCount}
            </span>
          ) : null}
        </div>
      ) : null}

      <a
        className="absolute right-1 bottom-1 z-[1000] rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:underline"
        href="https://www.amap.com/"
        target="_blank"
        rel="noreferrer"
      >
        © 高德地图
      </a>

      {loadFailed ? (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-background/90 text-sm text-muted-foreground">
          {t("perlica.mapLoadFailed")}
        </div>
      ) : null}
    </div>
  )
}
