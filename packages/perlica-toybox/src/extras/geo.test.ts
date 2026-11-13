import { describe, expect, it } from "vitest"
import { gcj02ToWgs84, isUsableLatLng, wgs84ToGcj02 } from "./geo"

describe("perlica geo conversion", () => {
  it("rejects missing and out-of-range coordinates", () => {
    expect(isUsableLatLng(0, 0)).toBe(false)
    expect(isUsableLatLng(Number.NaN, 119.6)).toBe(false)
    expect(isUsableLatLng(91, 119.6)).toBe(false)
    expect(isUsableLatLng(39.93, 181)).toBe(false)
    expect(isUsableLatLng(39.93, 119.61)).toBe(true)
  })

  it("converts WGS-84 to GCJ-02 inside mainland China", () => {
    const qinhuangdao = wgs84ToGcj02(39.93450164794922, 119.61062622070312)
    expect(qinhuangdao.lat).toBeCloseTo(39.93561330516375, 9)
    expect(qinhuangdao.lng).toBeCloseTo(119.61639466431807, 9)

    const beijing = wgs84ToGcj02(39.908722, 116.397499)
    expect(beijing.lat).toBeCloseTo(39.91012550007891, 9)
    expect(beijing.lng).toBeCloseTo(116.4037425752605, 9)
  })

  it("leaves coordinates outside mainland China untouched", () => {
    expect(wgs84ToGcj02(35.6762, 139.6503)).toEqual({ lat: 35.6762, lng: 139.6503 })
    expect(gcj02ToWgs84(35.6762, 139.6503)).toEqual({ lat: 35.6762, lng: 139.6503 })
  })

  it("round-trips GCJ-02 back to WGS-84 within a metre", () => {
    const source = { lat: 39.93450164794922, lng: 119.61062622070312 }
    const projected = wgs84ToGcj02(source.lat, source.lng)
    const restored = gcj02ToWgs84(projected.lat, projected.lng)

    expect(Math.abs(restored.lat - source.lat)).toBeLessThan(1e-5)
    expect(Math.abs(restored.lng - source.lng)).toBeLessThan(1e-5)
  })

  it("keeps GCJ-02 map centers from drifting when converted back to API coordinates", () => {
    const mapCenter = wgs84ToGcj02(39.93450164794922, 119.61062622070312)
    const apiCenter = gcj02ToWgs84(mapCenter.lat, mapCenter.lng)

    // A raw GCJ-02 centre would be roughly 550 m east and 130 m north of the API point.
    expect(apiCenter.lng).toBeLessThan(mapCenter.lng - 0.005)
    expect(apiCenter.lat).toBeLessThan(mapCenter.lat)
  })
})
