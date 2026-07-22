/**
 * 考试安排 → 课表网格块的转换。
 *
 * 考试有绝对日期与起止时间，课表网格按（周次 × 星期 × 节次）组织。
 * 转换规则：考试日期落在当前展示周内 → 星期几；考试时间区间与节次
 * 时刻表重叠 → 起止节次（无重叠时钳到最近节次，如晚间考试）。
 */
import type { ClassPeriod, CurrentWeek, Exam } from "@/providers/types";
import { buildSectionTimeMap } from "./schedule-utils";

export interface ExamBlock {
  exam: Exam;
  /** 星期几（1-7）。 */
  day: number;
  /** 起始节次。 */
  start: number;
  /** 结束节次。 */
  end: number;
}

function mondayOfWeek(currentWeek: CurrentWeek, selectedWeek: number): Date | null {
  const start = currentWeek.weekStartDate ?? currentWeek.weekDates?.[0];
  if (!start) return null;
  const monday = new Date(`${start}T00:00:00`);
  if (Number.isNaN(monday.getTime())) return null;
  monday.setDate(monday.getDate() + (selectedWeek - currentWeek.week) * 7);
  return monday;
}

function toMinutes(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function mapExamToSections(
  exam: Exam,
  timeMap: Record<number, [number, number]>,
): { start: number; end: number } | null {
  if (!exam.startTimestamp || !exam.endTimestamp) return null;
  const startMin = toMinutes(new Date(exam.startTimestamp));
  const endMin = toMinutes(new Date(exam.endTimestamp));

  const sections = Object.keys(timeMap)
    .map(Number)
    .sort((a, b) => a - b);
  if (sections.length === 0) return null;

  const overlapping = sections.filter((s) => {
    const [ps, pe] = timeMap[s]!;
    return ps < endMin && pe > startMin;
  });
  if (overlapping.length > 0) {
    return { start: overlapping[0]!, end: overlapping[overlapping.length - 1]! };
  }

  // 无重叠（如晚间考试）：钳到时间上最近的节次
  let nearest = sections[0]!;
  let nearestDist = Infinity;
  for (const s of sections) {
    const [ps, pe] = timeMap[s]!;
    const dist = startMin >= pe ? startMin - pe : ps >= endMin ? ps - endMin : 0;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = s;
    }
  }
  return { start: nearest, end: nearest };
}

export function computeExamBlocks(
  exams: Exam[],
  periods: ClassPeriod[],
  currentWeek: CurrentWeek | null,
  selectedWeek: number,
): ExamBlock[] {
  if (!currentWeek?.week || selectedWeek <= 0) return [];
  const monday = mondayOfWeek(currentWeek, selectedWeek);
  if (!monday) return [];

  const timeMap = buildSectionTimeMap(periods);
  const blocks: ExamBlock[] = [];
  for (const exam of exams) {
    if (!exam.startTimestamp) continue;
    const date = new Date(exam.startTimestamp);
    const dayDiff = Math.floor(
      (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
        monday.getTime()) /
        86_400_000,
    );
    if (dayDiff < 0 || dayDiff > 6) continue;
    const sections = mapExamToSections(exam, timeMap);
    if (!sections) continue;
    blocks.push({ exam, day: dayDiff + 1, ...sections });
  }
  return blocks;
}
