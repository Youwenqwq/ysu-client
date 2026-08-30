import type { Course } from "@/providers/types"

const PALETTE_SIZE = 6

export function courseColorIndex(course: Pick<Course, "code" | "name">): number {
  const key = course.code || course.name || ""
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % PALETTE_SIZE
}

export const COURSE_BG_CLASSES = [
  "bg-schedule-1",
  "bg-schedule-2",
  "bg-schedule-3",
  "bg-schedule-4",
  "bg-schedule-5",
  "bg-schedule-6",
] as const
