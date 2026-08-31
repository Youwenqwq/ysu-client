import type { Course } from "@/providers/types"

export const COURSE_PALETTE_SIZE = 8

/**
 * 颜色分配基于整张课表的课程集合（buildCourseColorMap），而非逐课独立哈希：
 * 课程数不超过调色板大小时保证互不撞色；超出的课程回落到自身哈希槽位。
 * 分配过程确定性且增量稳定：已分配的课程在课表增删后保持原色。
 */
export type CourseColorMap = Map<string, number>

export const COURSE_BG_CLASSES = [
  "bg-schedule-1",
  "bg-schedule-2",
  "bg-schedule-3",
  "bg-schedule-4",
  "bg-schedule-5",
  "bg-schedule-6",
  "bg-schedule-7",
  "bg-schedule-8",
] as const

function hashIndex(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0
  }
  // >>> 0 转无符号，避免 Math.abs(-2**31) 仍为负导致 % 后出现负索引
  return (hash >>> 0) % COURSE_PALETTE_SIZE
}

export function buildCourseColorMap(
  courses: Iterable<Pick<Course, "code" | "name">>
): CourseColorMap {
  const keys = new Set<string>()
  for (const course of courses) keys.add(course.code || course.name || "")

  const used = new Array<boolean>(COURSE_PALETTE_SIZE).fill(false)
  const map: CourseColorMap = new Map()
  for (const key of [...keys].sort()) {
    const preferred = hashIndex(key)
    let index = used[preferred] ? -1 : preferred
    if (index < 0) {
      for (let i = 0; i < COURSE_PALETTE_SIZE; i++) {
        if (!used[i]) {
          index = i
          break
        }
      }
    }
    if (index < 0) index = preferred
    used[index] = true
    map.set(key, index)
  }
  return map
}

export function courseBgClass(
  colorMap: CourseColorMap,
  course: Pick<Course, "code" | "name">
): string {
  const key = course.code || course.name || ""
  const index = colorMap.get(key) ?? hashIndex(key)
  return COURSE_BG_CLASSES[index]
}
