import { describe, expect, it } from "vitest"
import type { ProviderGPAScale } from "@orahako/plugin-sdk"
import { YSU_GPA_SCALE } from "../ysu/grade-letters"
import { gpaBandIndex } from "./gpa-band"

const FIVE_POINT_GPA_SCALE: ProviderGPAScale = {
  max: 5,
  bands: [
    { min: 0, letter: "F" },
    { min: 1, letter: "D" },
    { min: 2, letter: "C" },
    { min: 3, letter: "B" },
    { min: 4, letter: "A" },
    { min: 4.5, letter: "A+" },
  ],
}

function letterAt(scale: ProviderGPAScale, gpa: number) {
  return scale.bands[gpaBandIndex(gpa, scale.bands)]!.letter
}

describe("GPA grade bands", () => {
  it("uses the supplied scale instead of a shared rating table", () => {
    expect(letterAt(YSU_GPA_SCALE, 4)).toBe("A-")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4)).toBe("A")
    expect(YSU_GPA_SCALE.max).toBe(4.5)
    expect(FIVE_POINT_GPA_SCALE.max).toBe(5)
  })

  it("uses inclusive lower bounds at rating transitions", () => {
    expect(letterAt(YSU_GPA_SCALE, 1.19)).toBe("F")
    expect(letterAt(YSU_GPA_SCALE, 1.2)).toBe("D")
    expect(letterAt(YSU_GPA_SCALE, 4.29)).toBe("A-")
    expect(letterAt(YSU_GPA_SCALE, 4.3)).toBe("A")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4.49)).toBe("A")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4.5)).toBe("A+")
  })

  it("keeps out-of-range values in the nearest end band", () => {
    expect(letterAt(YSU_GPA_SCALE, -0.1)).toBe("F")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 5.1)).toBe("A+")
  })
})
