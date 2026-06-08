import type { Course, ClassPeriod, CurrentWeek } from "@/providers/types";

export type ScheduleCourse = Course;
export type ScheduleClassPeriod = ClassPeriod;

export function courseWeekDay(course: ScheduleCourse): number {
  return course.weekDay;
}

export function courseStartSection(course: ScheduleCourse): number {
  return course.startSection;
}

export function courseEndSection(course: ScheduleCourse): number {
  return course.endSection;
}

export function periodStartTime(period: ScheduleClassPeriod): string | undefined {
  return period.startTime;
}

export function periodEndTime(period: ScheduleClassPeriod): string | undefined {
  return period.endTime;
}

export function periodIsInUse(period: ScheduleClassPeriod): boolean {
  return period.isInUse;
}

export function parseTimeToMinutes(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function buildSectionTimeMap(periods: ScheduleClassPeriod[]): Record<number, [number, number]> {
  const map: Record<number, [number, number]> = {};
  for (const p of periods) {
    const start = Number.isFinite(p.startMinute) ? p.startMinute : parseTimeToMinutes(periodStartTime(p));
    const end = Number.isFinite(p.endMinute) ? p.endMinute : parseTimeToMinutes(periodEndTime(p));
    if (start !== null && start !== undefined && end !== null && end !== undefined) {
      map[p.section] = [start, end];
    }
  }
  return map;
}

function formatShortDate(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return `${parts[1]}/${parts[2]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function computeWeekDateLabels(currentWeek: CurrentWeek | null, selectedWeek: number): (string | null)[] {
  if (!currentWeek?.week) return Array(7).fill(null);

  if (Array.isArray(currentWeek.weekDates) && currentWeek.weekDates.length === 7) {
    if (selectedWeek === currentWeek.week) {
      return currentWeek.weekDates.map(formatShortDate);
    }
    const start = currentWeek.weekStartDate ?? currentWeek.weekDates[0];
    if (start) {
      const base = new Date(start);
      if (!Number.isNaN(base.getTime())) {
        base.setDate(base.getDate() + (selectedWeek - currentWeek.week) * 7);
        return Array.from({ length: 7 }, (_, idx) => {
          const dt = new Date(base);
          dt.setDate(base.getDate() + idx);
          return `${dt.getMonth() + 1}/${dt.getDate()}`;
        });
      }
    }
  }

  if (!currentWeek.date || !currentWeek.weekday) return Array(7).fill(null);
  const base = new Date(currentWeek.date);
  if (Number.isNaN(base.getTime())) return Array(7).fill(null);
  const mondayOffset = currentWeek.weekday - 1;
  const weekDelta = selectedWeek - currentWeek.week;
  const monday = new Date(base);
  monday.setDate(base.getDate() - mondayOffset + weekDelta * 7);
  return Array.from({ length: 7 }, (_, idx) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + idx);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });
}

export function isCoursePast(
  course: ScheduleCourse,
  nowMinutes: number,
  timeMap: Record<number, [number, number]>,
): boolean {
  const endRange = timeMap[courseEndSection(course)];
  return !!endRange && nowMinutes > endRange[1];
}

export function isCourseCurrent(
  course: ScheduleCourse,
  nowMinutes: number,
  timeMap: Record<number, [number, number]>,
): boolean {
  for (let s = courseStartSection(course); s <= courseEndSection(course); s++) {
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

export function isCourseActiveInWeek(course: ScheduleCourse, week: number): boolean {
  const weeks = course.weekList ?? parseWeeks(course.weeks || "");
  if (weeks.length === 0) return true;
  return weeks.includes(week);
}

export function coursesSignature(courses: ScheduleCourse[]): string {
  return courses
    .map(
      (c) =>
        `${c.code ?? ""}|${c.name ?? ""}|${c.teacher ?? ""}|${c.classroom ?? ""}|${courseStartSection(c)}|${courseEndSection(c)}`,
    )
    .sort()
    .join("\n");
}

export interface ScheduleBlock<TCourse extends ScheduleCourse = ScheduleCourse> {
  day: number;
  start: number;
  end: number;
  courses: TCourse[];
}

export function computeMergedBlocks<TCourse extends ScheduleCourse>(
  courses: TCourse[],
  periods: ScheduleClassPeriod[],
): ScheduleBlock<TCourse>[] {
  const maxSection = periods.length > 0 ? periods[periods.length - 1].section : 12;
  const grid: { courses: TCourse[] }[][] = Array.from({ length: maxSection + 1 }, () =>
    Array.from({ length: 8 }, () => ({ courses: [] as TCourse[] })),
  );
  for (const c of courses) {
    const weekDay = courseWeekDay(c);
    const startSection = courseStartSection(c);
    if (weekDay >= 1 && weekDay <= 7 && startSection >= 1) {
      for (let s = startSection; s <= courseEndSection(c); s++) {
        if (s <= maxSection) {
          grid[s][weekDay].courses.push(c);
        }
      }
    }
  }
  const blocks: ScheduleBlock<TCourse>[] = [];
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
