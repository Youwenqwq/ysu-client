import type * as LeafletModule from "leaflet"
import type { Map as LeafletMap, TileLayer } from "leaflet"

export type Leaflet = typeof LeafletModule

/**
 * AMap raster tiles. Their CRS is GCJ-02, not WGS-84: callers must convert
 * coordinates with `wgs84ToGcj02` / `gcj02ToWgs84` before crossing this boundary.
 * The public tile host is reachable from mainland China, unlike OSM.
 */
const AMAP_TILE_URL =
  "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"

export function addAmapTileLayer(L: Leaflet, map: LeafletMap): TileLayer {
  return L.tileLayer(AMAP_TILE_URL, {
    subdomains: ["1", "2", "3", "4"],
    minZoom: 3,
    maxZoom: 18,
  }).addTo(map)
}

export const AMAP_ATTRIBUTION_URL = "https://www.amap.com/"
