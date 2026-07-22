/**
 * 燕山大学课程考核成绩与等级制对应表。
 * 来源:燕山大学教务处《燕山大学本科生学业成绩评定说明》(2024-09-01)
 * https://jwc.ysu.edu.cn/info/1024/3709.htm
 *
 * 三个时期的百分制 -> 等级制换算不同,按课程所在学期选表:
 * - 2022 春季学期以前
 * - 2022 春季 ~ 2024 春季
 * - 2024 秋季学期及以后
 *
 * 注意:此映射为 YSU 教务政策,属 provider 私域。当前抽卡 UI 直接引用;
 * 若未来接入第二所学校,应把等级换算提升为 provider 接口方法。
 */

export type GradeLetter =
  | "A+" | "A" | "A-"
  | "B+" | "B" | "B-"
  | "C+" | "C" | "C-"
  | "D+" | "D"
  | "F" | "F-";

type Row = [min: number, letter: GradeLetter];

/** 2022 年春季学期以前 */
const TABLE_BEFORE_2022: readonly Row[] = [
  [96, "A+"], [90, "A"], [85, "B+"], [80, "B"], [75, "C+"],
  [70, "C"], [65, "D+"], [60, "D"], [40, "F"], [0, "F-"],
];

/** 2022 年春季学期 ~ 2024 年春季学期 */
const TABLE_2022_TO_2024: readonly Row[] = [
  [96, "A+"], [90, "A"], [86, "B+"], [82, "B"], [78, "B-"],
  [74, "C+"], [70, "C"], [65, "C-"], [60, "D"], [40, "F"], [0, "F-"],
];

/** 2024 年秋季学期及以后 */
const TABLE_SINCE_2024: readonly Row[] = [
  [97, "A+"], [93, "A"], [89, "A-"], [85, "B+"], [81, "B"],
  [77, "B-"], [73, "C+"], [69, "C"], [65, "C-"], [60, "D"], [40, "F"], [0, "F-"],
];

/** 按学期代码(如 2025-2026-2)选择对应时期的换算表,无法解析时用现行表。 */
function tableFor(semester?: string): readonly Row[] {
  const m = semester?.match(/^(\d{4})-\d{4}-(\d)$/);
  if (!m) return TABLE_SINCE_2024;
  const year = Number(m[1]);
  const term = Number(m[2]);
  // 2024 秋季 = 2024-2025-1
  if (year > 2024 || (year === 2024 && term === 1)) return TABLE_SINCE_2024;
  // 2022 春 = 2021-2022-2,2024 春 = 2023-2024-2
  if ((year === 2021 && term === 2) || year === 2022 || year === 2023) {
    return TABLE_2022_TO_2024;
  }
  return TABLE_BEFORE_2022;
}

/** 百分制分数 -> 等级制字母(时期感知)。 */
export function letterOfScore(score: number, semester?: string): GradeLetter {
  const table = tableFor(semester);
  for (const [min, letter] of table) {
    if (score >= min) return letter;
  }
  return "F-";
}

/** 五级制/二级制中文等级 -> 字母;已是字母的原样返回。 */
export function letterOfGradeLevel(gradeLevel?: string): GradeLetter | undefined {
  const text = gradeLevel?.trim();
  if (!text) return undefined;
  const asLetter = text.match(/^([A-F])([+-])?$/i);
  if (asLetter) {
    return (asLetter[1].toUpperCase() + (asLetter[2] ?? "")) as GradeLetter;
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
  };
  return map[text];
}

/** 抽卡视觉层级:A+ 彩虹全息,A 金,B 紫,C 蓝,D 灰,F 红。 */
export type GachaTier = "aplus" | "a" | "b" | "c" | "d" | "f";

export function tierOfLetter(letter: GradeLetter): GachaTier {
  if (letter === "A+") return "aplus";
  if (letter === "A" || letter === "A-") return "a";
  if (letter === "B+" || letter === "B" || letter === "B-") return "b";
  if (letter === "C+" || letter === "C" || letter === "C-") return "c";
  if (letter === "D" || letter === "D+") return "d";
  return "f";
}
