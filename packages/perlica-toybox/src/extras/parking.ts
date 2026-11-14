import { distanceMeters, isUsableLatLng } from "./geo"
import type { PerlicaCoords, PerlicaParkPoint } from "./types"

export const PARK_POINT_SEARCH_RADIUS_METERS = 500
export const AUTO_SNAP_RADIUS_METERS = 100

/**
 * Return usable nearby points ordered by GPS distance and snap only when the
 * nearest point is close enough to correct normal positioning error safely.
 */
export function selectParkingPoints(points: PerlicaParkPoint[], coords: PerlicaCoords) {
  const ranked = points
    .filter(
      (point) =>
        isUsableLatLng(point.lat, point.lng) &&
        point.raw.enable !== 0 &&
        point.raw.enable !== false &&
        point.raw.visible !== false
    )
    .map((point) => ({ ...point, distance: distanceMeters(coords, point) }))
    .sort((a, b) => a.distance - b.distance)
  const nearest = ranked[0]
  return {
    points: ranked,
    snapped: nearest && nearest.distance <= AUTO_SNAP_RADIUS_METERS ? nearest : null,
  }
}
