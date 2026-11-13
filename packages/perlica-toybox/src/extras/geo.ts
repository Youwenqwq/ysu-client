/**
 * WGS-84 (GPS / Perlica API) <-> GCJ-02 (AMap tiles) conversion.
 *
 * AMap raster tiles are in GCJ-02. Drawing raw WGS-84 coordinates on them shifts
 * every marker by several hundred metres, so every point crossing the map
 * boundary must be converted in the corresponding direction.
 */

export interface PerlicaLatLng {
  lat: number
  lng: number
}

const AXIS = 6378245.0
const ECC = 0.00669342162296594323
const PI = Math.PI

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(x: number, y: number): number {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  result += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  result += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3
  result += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3
  return result
}

function transformLng(x: number, y: number): number {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  result += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3
  result += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3
  result += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3
  return result
}

/** Whether a coordinate can be plotted on a world map. `0, 0` is treated as missing. */
export function isUsableLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

/** Convert a WGS-84 coordinate to GCJ-02 for display on AMap tiles. */
export function wgs84ToGcj02(lat: number, lng: number): PerlicaLatLng {
  if (!isUsableLatLng(lat, lng) || outOfChina(lat, lng)) return { lat, lng }

  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const radLat = (lat / 180) * PI
  let magic = Math.sin(radLat)
  magic = 1 - ECC * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((AXIS * (1 - ECC)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((AXIS / sqrtMagic) * Math.cos(radLat) * PI)
  return { lat: lat + dLat, lng: lng + dLng }
}

/** Convert a GCJ-02 coordinate (map interaction) back to WGS-84 for the API. */
export function gcj02ToWgs84(lat: number, lng: number): PerlicaLatLng {
  if (!isUsableLatLng(lat, lng) || outOfChina(lat, lng)) return { lat, lng }

  // Two fixed-point iterations put the round trip below a metre.
  let result: PerlicaLatLng = { lat, lng }
  for (let index = 0; index < 2; index += 1) {
    const projected = wgs84ToGcj02(result.lat, result.lng)
    result = {
      lat: result.lat + (lat - projected.lat),
      lng: result.lng + (lng - projected.lng),
    }
  }
  return result
}
