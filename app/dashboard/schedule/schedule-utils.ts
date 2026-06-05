import type { Course, ClassPeriod } from "@/lib/types";

export function parseTimeToMinutes(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function buildSectionTimeMap(periods: ClassPeriod[]): Record<number, [number, number]> {
  const map: Record<number, [number, number]> = {};
  for (const p of periods) {
    const start = parseTimeToMinutes(p.start_time);
    const end = parseTimeToMinutes(p.end_time);
    if (start !== null && end !== null) {
      map[p.section] = [start, end];
    }
  }
  return map;
}

export function isCoursePast(
  course: Course,
  nowMinutes: number,
  timeMap: Record<number, [number, number]>,
): boolean {
  const endRange = timeMap[course.end_section];
  return !!endRange && nowMinutes > endRange[1];
}

export function isCourseCurrent(
  course: Course,
  nowMinutes: number,
  timeMap: Record<number, [number, number]>,
): boolean {
  for (let s = course.start_section; s <= course.end_section; s++) {
    const range = timeMap[s];
    if (range && nowMinutes >= range[0] && nowMinutes <= range[1]) {
      return true;
    }
  }
  return false;
}

export function parseWeeks(weeksStr: string): number[] {
  const result = new Set<number>();
  if (!weeksStr) return [];
  const cleaned = weeksStr.replace(/[周第\s]/g, "");
  const parts = cleaned.split(/[,，]/);
  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((s) => parseInt(s, 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let w = start; w <= end; w++) result.add(w);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) result.add(n);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

export function isCourseActiveInWeek(course: Course, week: number): boolean {
  const weeks = parseWeeks(course.weeks || "");
  if (weeks.length === 0) return true;
  return weeks.includes(week);
}

export function coursesSignature(courses: Course[]): string {
  return courses
    .map(
      (c) =>
        `${c.code ?? ""}|${c.name ?? ""}|${c.teacher ?? ""}|${c.classroom ?? ""}|${c.start_section}|${c.end_section}`,
    )
    .sort()
    .join("\n");
}

export interface ScheduleBlock {
  day: number;
  start: number;
  end: number;
  courses: Course[];
}

export function computeMergedBlocks(courses: Course[], periods: ClassPeriod[]): ScheduleBlock[] {
  const maxSection = periods.length > 0 ? periods[periods.length - 1].section : 12;
  const grid: { courses: Course[] }[][] = Array.from({ length: maxSection + 1 }, () =>
    Array.from({ length: 8 }, () => ({ courses: [] as Course[] })),
  );
  for (const c of courses) {
    if (c.week_day >= 1 && c.week_day <= 7 && c.start_section >= 1) {
      for (let s = c.start_section; s <= c.end_section; s++) {
        if (s <= maxSection) {
          grid[s][c.week_day].courses.push(c);
        }
      }
    }
  }
  const blocks: ScheduleBlock[] = [];
  for (let day = 1; day <= 7; day++) {
    let section = 1;
    while (section <= maxSection) {
      const cell = grid[section][day];
      if (cell.courses.length === 0) {
        section++;
        continue;
      }
      const sig = coursesSignature(cell.courses);
      let end = section;
      while (
        end + 1 <= maxSection &&
        grid[end + 1][day].courses.length === cell.courses.length &&
        coursesSignature(grid[end + 1][day].courses) === sig
      ) {
        end++;
      }
      blocks.push({ day, start: section, end, courses: cell.courses });
      section = end + 1;
    }
  }
  return blocks;
}
