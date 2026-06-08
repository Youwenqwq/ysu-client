import type { Exam } from "@/providers/types";

function parseLocalDateTime(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimeFromDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/T(\d{2}:\d{2})/);
  return match?.[1] ?? null;
}

export function getExamStartTime(exam: Exam): Date | null {
  return parseLocalDateTime(exam.startAt);
}

export function getExamEndTime(exam: Exam): Date | null {
  return parseLocalDateTime(exam.endAt) ?? parseLocalDateTime(exam.startAt);
}

export function isExamCompleted(exam: Exam, now: Date = new Date()): boolean {
  const end = getExamEndTime(exam);
  if (!end) return false;
  return end < now;
}

export function compareExamStartTime(a: Exam, b: Exam): number {
  const aStart = getExamStartTime(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bStart = getExamStartTime(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aStart !== bStart) return aStart - bStart;

  const aEnd = getExamEndTime(a)?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = getExamEndTime(b)?.getTime() ?? Number.POSITIVE_INFINITY;
  return aEnd - bEnd;
}

export function formatExamTime(exam: Exam): string {
  if (exam.timeText) return exam.timeText;

  const start = formatTimeFromDateTime(exam.startAt);
  const end = formatTimeFromDateTime(exam.endAt);
  if (start && end) return `${start}-${end}`;
  return start ?? end ?? "";
}
