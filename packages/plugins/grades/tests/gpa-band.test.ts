import { describe, expect, it } from "vitest"
import type { GradeLetter, ProviderGPAScale, ProviderGradeScale } from "@orahako/academic-sdk"
import { gpaBandIndex, resolveGradeLetter, tierOfLetter } from "../src/gpa-band"

const FOUR_POINT_FIVE_SCALE: ProviderGPAScale = {
  max: 4.5,
  bands: [
    { min: 0, letter: "F" },
    { min: 1.2, letter: "D" },
    { min: 1.8, letter: "C-" },
    { min: 2.2, letter: "C" },
    { min: 2.6, letter: "C+" },
    { min: 3, letter: "B-" },
    { min: 3.4, letter: "B" },
    { min: 3.8, letter: "B+" },
    { min: 4, letter: "A-" },
    { min: 4.3, letter: "A" },
    { min: 4.5, letter: "A+" },
  ],
}

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

const FOUR_POINT_GPA_SCALE: ProviderGPAScale = {
  max: 4,
  bands: [
    { min: 0, letter: "F" },
    { min: 1, letter: "D" },
    { min: 2, letter: "C" },
    { min: 3, letter: "B" },
    { min: 3.7, letter: "A-" },
    { min: 4, letter: "A" },
  ],
}

const CUSTOM_GRADE_SCALE: ProviderGradeScale = {
  letterOfScore(score: number, semester?: string): GradeLetter {
    if (semester === "2020-2021-1" && score >= 95) return "A+"
    if (score >= 98) return "A+"
    if (score >= 90) return "A"
    if (score >= 80) return "B"
    if (score >= 70) return "C"
    if (score >= 60) return "D"
    return "F"
  },
  letterOfGradeLevel(level?: string): GradeLetter | undefined {
    if (level === "Distinction") return "A+"
    if (level === "Merit") return "B+"
    if (level === "Pass") return "C"
    if (level === "Fail") return "F"
    return undefined
  },
}

function letterAt(scale: ProviderGPAScale, gpa: number): GradeLetter {
  return scale.bands[gpaBandIndex(gpa, scale.bands)]!.letter
}

describe("GPA grade bands & custom provider scales", () => {
  it("uses the supplied provider GPA scale instead of any hardcoded school table", () => {
    expect(letterAt(FOUR_POINT_FIVE_SCALE, 4)).toBe("A-")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4)).toBe("A")
    expect(letterAt(FOUR_POINT_GPA_SCALE, 3.8)).toBe("A-")
    expect(FOUR_POINT_FIVE_SCALE.max).toBe(4.5)
    expect(FIVE_POINT_GPA_SCALE.max).toBe(5)
    expect(FOUR_POINT_GPA_SCALE.max).toBe(4)
  })

  it("uses inclusive lower bounds at band transitions", () => {
    expect(letterAt(FOUR_POINT_FIVE_SCALE, 1.19)).toBe("F")
    expect(letterAt(FOUR_POINT_FIVE_SCALE, 1.2)).toBe("D")
    expect(letterAt(FOUR_POINT_FIVE_SCALE, 4.29)).toBe("A-")
    expect(letterAt(FOUR_POINT_FIVE_SCALE, 4.3)).toBe("A")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4.49)).toBe("A")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 4.5)).toBe("A+")
  })

  it("clamps out-of-range GPA values to the nearest end band", () => {
    expect(letterAt(FOUR_POINT_FIVE_SCALE, -0.1)).toBe("F")
    expect(letterAt(FIVE_POINT_GPA_SCALE, 5.2)).toBe("A+")
  })

  it("resolves course letters from the active provider gradeScale with graceful fallbacks", () => {
    expect(
      resolveGradeLetter({ score: "96", semester: "2020-2021-1", isPass: true }, CUSTOM_GRADE_SCALE)
    ).toBe("A+")
    expect(
      resolveGradeLetter({ score: "96", semester: "2025-2026-1", isPass: true }, CUSTOM_GRADE_SCALE)
    ).toBe("A")
    expect(
      resolveGradeLetter({ gradeLevel: "Distinction", isPass: true }, CUSTOM_GRADE_SCALE)
    ).toBe("A+")
    expect(resolveGradeLetter({ gradeLevel: "Merit", isPass: true }, CUSTOM_GRADE_SCALE)).toBe("B+")
    expect(resolveGradeLetter({ score: "92", isPass: true }, undefined)).toBe("C")
    expect(resolveGradeLetter({ score: "45", isPass: false }, undefined)).toBe("F")
  })

  it("maps all standard grade letters to rarity tiers", () => {
    expect(tierOfLetter("A+")).toBe("aplus")
    expect(tierOfLetter("A")).toBe("a")
    expect(tierOfLetter("A-")).toBe("a")
    expect(tierOfLetter("B+")).toBe("b")
    expect(tierOfLetter("B")).toBe("b")
    expect(tierOfLetter("B-")).toBe("b")
    expect(tierOfLetter("C+")).toBe("c")
    expect(tierOfLetter("C")).toBe("c")
    expect(tierOfLetter("C-")).toBe("c")
    expect(tierOfLetter("D+")).toBe("d")
    expect(tierOfLetter("D")).toBe("d")
    expect(tierOfLetter("F")).toBe("f")
    expect(tierOfLetter("F-")).toBe("f")
  })
})
