import type { GPAGradeBand, GradeLetter, ProviderGradeScale } from "@orahako/academic-sdk"

export type GachaTier = "aplus" | "a" | "b" | "c" | "d" | "f"

export interface GradeLetterCandidate {
  readonly score?: string
  readonly numericScore?: number
  readonly gradeLevel?: string
  readonly semester?: string
  readonly isPass: boolean
}

/** Return the last band whose inclusive lower bound does not exceed the GPA. */
export function gpaBandIndex(
  gpa: number,
  bands: readonly [GPAGradeBand, ...GPAGradeBand[]]
): number {
  let index = 0
  for (let i = 1; i < bands.length; i++) {
    if (gpa < bands[i]!.min) break
    index = i
  }
  return index
}

/** Visual card rarity tier mapped from standard grade letters. */
export function tierOfLetter(letter: GradeLetter): GachaTier {
  if (letter === "A+") return "aplus"
  if (letter === "A" || letter === "A-") return "a"
  if (letter === "B+" || letter === "B" || letter === "B-") return "b"
  if (letter === "C+" || letter === "C" || letter === "C-") return "c"
  if (letter === "D" || letter === "D+") return "d"
  return "f"
}

/**
 * Resolves a card's grade letter strictly from the active provider's `gradeScale`
 * (never hardcoding school-specific score boundaries in the UI).
 */
export function resolveGradeLetter(
  item: GradeLetterCandidate,
  scale?: ProviderGradeScale
): GradeLetter {
  const numeric = item.numericScore ?? (item.score !== undefined ? Number(item.score) : Number.NaN)
  if (Number.isFinite(numeric) && scale) {
    return scale.letterOfScore(numeric, item.semester)
  }
  const level = scale
    ? (scale.letterOfGradeLevel(item.gradeLevel) ?? scale.letterOfGradeLevel(item.score))
    : undefined
  return level ?? (item.isPass ? "C" : "F")
}
