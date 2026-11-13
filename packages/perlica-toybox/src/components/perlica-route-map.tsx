"use client"

import { useEffect, useRef, useState } from "react"
import type { DivIcon, Map as LeafletMap, Marker, Polyline } from "leaflet"
import { isUsableLatLng, wgs84ToGcj02 } from "../extras/geo"
import { usePluginTranslation } from "@ysu/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { addAmapTileLayer, type Leaflet } from "./perlica-map-tiles"
import type { PerlicaMapCenter } from "./perlica-map"

export interface PerlicaRouteMapProps {
  start?: PerlicaMapCenter | null
  end?: PerlicaMapCenter | null
  startName?: string
  endName?: string
}

function isValidPoint(point: PerlicaMapCenter | null | undefined): point is PerlicaMapCenter {
  return Boolean(point && isUsableLatLng(point.lat, point.lng))
}

function createRouteIcon(
  L: Leaflet,
  label: string,
  color: string,
  shifted: "left" | "right" | null
): DivIcon {
  const size = 36
  const iconAnchor: [number, number] =
    shifted === "left"
      ? [size, size / 2]
      : shifted === "right"
        ? [0, size / 2]
        : [size / 2, size / 2]

  return L.divIcon({
    className: "perlica-route-marker",
    html: `<div style="box-sizing:border-box;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(15,23,42,.4);color:#fff;font:600 12px/1 system-ui,sans-serif;white-space:nowrap">${label}</div>`,
    iconSize: [size, size],
    iconAnchor,
  })
}

function updateMarkerLabel(marker: Marker, label: string) {
  marker.options.title = label
  marker.options.alt = label
  const element = marker.getElement()
  if (element) {
    element.title = label
    element.setAttribute("aria-label", label)
  }

  const content = document.createElement("span")
  content.textContent = label
  if (marker.getTooltip()) {
    marker.setTooltipContent(content)
  } else {
    marker.bindTooltip(content, { direction: "top", offset: [0, -18] })
  }
}

export function PerlicaRouteMap({ start, end, startName, endName }: PerlicaRouteMapProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)
  const validStart = isValidPoint(start) ? start : null
  const validEnd = isValidPoint(end) ? end : null
  const startLat = validStart?.lat ?? null
  const startLng = validStart?.lng ?? null
  const endLat = validEnd?.lat ?? null
  const endLng = validEnd?.lng ?? null
  const hasPoints = validStart !== null || validEnd !== null
  const overlapping = Boolean(
    validStart && validEnd && validStart.lat === validEnd.lat && validStart.lng === validEnd.lng
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const initialPointRef = useRef(validStart ?? validEnd)
  const startMarkerRef = useRef<Marker | null>(null)
  const endMarkerRef = useRef<Marker | null>(null)
  const routeLineRef = useRef<Polyline | null>(null)
  const leafletRef = useRef<Leaflet | null>(null)
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    initialPointRef.current = validStart ?? validEnd
  }, [validEnd, validStart])

  useEffect(() => {
    if (!hasPoints) return

    let disposed = false
    let map: LeafletMap | null = null

    async function initializeMap() {
      try {
        // Leaflet requires browser globals and therefore cannot be statically imported for SSR.
        const L = await import("leaflet")
        const container = containerRef.current
        const initialPoint = initialPointRef.current
        if (disposed || !container || !initialPoint) return
        setLoadFailed(false)

        const projected = wgs84ToGcj02(initialPoint.lat, initialPoint.lng)
        map = L.map(container, {
          center: [projected.lat, projected.lng],
          zoom: 16,
          zoomControl: false,
          attributionControl: false,
        })
        addAmapTileLayer(L, map)
        L.control.zoom({ position: "topright" }).addTo(map)

        leafletRef.current = L
        setMapInstance(map)
      } catch {
        if (!disposed) setLoadFailed(true)
      }
    }

    void initializeMap()

    return () => {
      disposed = true
      startMarkerRef.current = null
      endMarkerRef.current = null
      routeLineRef.current = null
      leafletRef.current = null
      map?.remove()
      setMapInstance(null)
    }
  }, [hasPoints])

  useEffect(() => {
    if (!mapInstance) return
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => mapInstance.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [mapInstance])

  useEffect(() => {
    const L = leafletRef.current
    if (!mapInstance || !L) return

    const startLabel = startName?.trim() || t("perlica.routeStart")
    const endLabel = endName?.trim() || t("perlica.routeEnd")
    const projectedStart =
      startLat !== null && startLng !== null ? wgs84ToGcj02(startLat, startLng) : null
    const projectedEnd = endLat !== null && endLng !== null ? wgs84ToGcj02(endLat, endLng) : null

    if (projectedStart) {
      const position: [number, number] = [projectedStart.lat, projectedStart.lng]
      const icon = createRouteIcon(
        L,
        t("perlica.routeStart"),
        "#16a34a",
        overlapping ? "left" : null
      )
      let marker = startMarkerRef.current
      if (!marker) {
        marker = L.marker(position, {
          bubblingMouseEvents: false,
          icon,
          keyboard: true,
          title: startLabel,
          alt: startLabel,
          zIndexOffset: 1000,
        }).addTo(mapInstance)
        startMarkerRef.current = marker
      } else {
        marker.setLatLng(position)
        marker.setIcon(icon)
      }
      updateMarkerLabel(marker, startLabel)
    } else {
      startMarkerRef.current?.remove()
      startMarkerRef.current = null
    }

    if (projectedEnd) {
      const position: [number, number] = [projectedEnd.lat, projectedEnd.lng]
      const icon = createRouteIcon(
        L,
        t("perlica.routeEnd"),
        "#dc2626",
        overlapping ? "right" : null
      )
      let marker = endMarkerRef.current
      if (!marker) {
        marker = L.marker(position, {
          bubblingMouseEvents: false,
          icon,
          keyboard: true,
          title: endLabel,
          alt: endLabel,
          zIndexOffset: 1000,
        }).addTo(mapInstance)
        endMarkerRef.current = marker
      } else {
        marker.setLatLng(position)
        marker.setIcon(icon)
      }
      updateMarkerLabel(marker, endLabel)
    } else {
      endMarkerRef.current?.remove()
      endMarkerRef.current = null
    }

    if (projectedStart && projectedEnd) {
      const startPosition: [number, number] = [projectedStart.lat, projectedStart.lng]
      const endPosition: [number, number] = [projectedEnd.lat, projectedEnd.lng]
      const line = routeLineRef.current
      if (line) {
        line.setLatLngs([startPosition, endPosition])
      } else {
        routeLineRef.current = L.polyline([startPosition, endPosition], {
          color: "#2563eb",
          dashArray: "6,5",
          interactive: false,
          opacity: 0.75,
          weight: 3,
        }).addTo(mapInstance)
      }
      mapInstance.fitBounds(L.latLngBounds(startPosition, endPosition), {
        animate: false,
        maxZoom: 16,
        padding: [48, 48],
      })
    } else {
      routeLineRef.current?.remove()
      routeLineRef.current = null
      const point = projectedStart ?? projectedEnd
      if (point) mapInstance.setView([point.lat, point.lng], 16, { animate: false })
    }
  }, [endLat, endLng, endName, mapInstance, overlapping, startLat, startLng, startName, t])

  return (
    <div className="relative isolate z-0 h-[280px] w-full overflow-hidden rounded-md bg-muted">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="application"
        aria-label={t("perlica.routeMapAriaLabel")}
        aria-hidden={!hasPoints}
      />
      <a
        className="absolute right-1 bottom-1 z-[1000] rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:underline"
        href="https://www.amap.com/"
        target="_blank"
        rel="noreferrer"
      >
        © 高德地图
      </a>
      {!hasPoints ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-background/90 px-4 text-center text-sm text-muted-foreground"
          role="status"
        >
          {t("perlica.routeEmpty")}
        </div>
      ) : loadFailed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/90 text-sm text-muted-foreground">
          {t("perlica.mapLoadFailed")}
        </div>
      ) : null}
    </div>
  )
}
