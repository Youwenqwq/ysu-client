import type { GPAGradeBand } from "@orahako/plugin-sdk"

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
