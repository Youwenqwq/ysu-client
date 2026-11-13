import type { GradeLetter, ProviderGPAScale } from "@orahako/plugin-sdk/academic"

/**
 * 燕山大学课程考核成绩与等级制对应表。
 * 来源:燕山大学教务处《燕山大学本科生学业成绩评定说明》(2024-09-01)
 * https://jwc.ysu.edu.cn/info/1024/3709.htm
 *
 * 三个时期的百分制 -> 等级制换算不同,按课程所在学期选表:
 * - 2022 春季学期以前
 * - 2022 春季 ~ 2024 春季
 * - 2024 秋季学期及以后
 */

type Row = [min: number, letter: GradeLetter]

/** 2022 年春季学期以前 */
const TABLE_BEFORE_2022: readonly Row[] = [
  [96, "A+"],
  [90, "A"],
  [85, "B+"],
  [80, "B"],
  [75, "C+"],
  [70, "C"],
  [65, "D+"],
  [60, "D"],
  [40, "F"],
  [0, "F-"],
]

/** 2022 年春季学期 ~ 2024 年春季学期 */
const TABLE_2022_TO_2024: readonly Row[] = [
  [96, "A+"],
  [90, "A"],
  [86, "B+"],
  [82, "B"],
  [78, "B-"],
  [74, "C+"],
  [70, "C"],
  [65, "C-"],
  [60, "D"],
  [40, "F"],
  [0, "F-"],
]

/** 2024 年秋季学期及以后 */
const TABLE_SINCE_2024: readonly Row[] = [
  [97, "A+"],
  [93, "A"],
  [89, "A-"],
  [85, "B+"],
  [81, "B"],
  [77, "B-"],
  [73, "C+"],
  [69, "C"],
  [65, "C-"],
  [60, "D"],
  [40, "F"],
  [0, "F-"],
]

/**
 * 2024 版成绩评定的平均绩点分档，属于客户端诠释，非官方定级。
 * A+ = 4.5，因此满绩为 4.5。
 */
export const YSU_GPA_SCALE: ProviderGPAScale = {
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

/** 按学期代码(如 2025-2026-2)选择对应时期的换算表,无法解析时用现行表。 */
function tableFor(semester?: string): readonly Row[] {
  const m = semester?.match(/^(\d{4})-\d{4}-(\d)$/)
  if (!m) return TABLE_SINCE_2024
  const year = Number(m[1])
  const term = Number(m[2])
  // 2024 秋季 = 2024-2025-1
  if (year > 2024 || (year === 2024 && term === 1)) return TABLE_SINCE_2024
  // 2022 春 = 2021-2022-2,2024 春 = 2023-2024-2
  if ((year === 2021 && term === 2) || year === 2022 || year === 2023) {
    return TABLE_2022_TO_2024
  }
  return TABLE_BEFORE_2022
}

/** 百分制分数 -> 等级制字母(时期感知)。 */
export function letterOfScore(score: number, semester?: string): GradeLetter {
  const table = tableFor(semester)
  for (const [min, letter] of table) {
    if (score >= min) return letter
  }
  return "F-"
}

/** 五级制/二级制中文等级 -> 字母;已是字母的原样返回。 */
export function letterOfGradeLevel(gradeLevel?: string): GradeLetter | undefined {
  const text = gradeLevel?.trim()
  if (!text) return undefined
  const asLetter = text.match(/^([A-F])([+-])?$/i)
  if (asLetter) {
    return (asLetter[1].toUpperCase() + (asLetter[2] ?? "")) as GradeLetter
  }
  const map: Record<string, GradeLetter> = {
    优秀: "A",
    良好: "B",
    中等: "C",
    及格: "D",
    及格以上: "D",
    不及格: "F",
    合格: "C",
    通过: "C",
    不合格: "F",
    不通过: "F",
  }
  return map[text]
}
