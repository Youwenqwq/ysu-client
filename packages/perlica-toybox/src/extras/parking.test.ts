import { describe, expect, it } from "vitest"
import { selectParkingPoints } from "./parking"
import type { PerlicaParkPoint } from "./types"

function point(id: string, lat: number, lng = 120, raw: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    address: "",
    lat,
    lng,
    distance: 0,
    area: [],
    raw,
  } satisfies PerlicaParkPoint
}

describe("selectParkingPoints", () => {
  it("sorts usable points by actual GPS distance and snaps within 100 meters", () => {
    const result = selectParkingPoints([point("far", 30.0015), point("near", 30.0005)], {
      lat: 30,
      lng: 120,
    })
    expect(result.points.map((item) => item.id)).toEqual(["near", "far"])
    expect(result.snapped?.id).toBe("near")
    expect(result.snapped?.distance).toBeGreaterThan(50)
    expect(result.snapped?.distance).toBeLessThan(60)
  })

  it("does not snap beyond 100 meters", () => {
    const result = selectParkingPoints([point("far", 30.001)], { lat: 30, lng: 120 })
    expect(result.points).toHaveLength(1)
    expect(result.snapped).toBeNull()
  })

  it("omits disabled, invisible, and invalid points", () => {
    const result = selectParkingPoints(
      [
        point("disabled", 30, 120, { enable: 0 }),
        point("hidden", 30, 120, { visible: false }),
        point("invalid", 0, 0),
        point("usable", 30.0002),
      ],
      { lat: 30, lng: 120 }
    )
    expect(result.points.map((item) => item.id)).toEqual(["usable"])
  })
})
