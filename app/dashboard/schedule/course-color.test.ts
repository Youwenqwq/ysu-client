import { describe, expect, it } from "vitest"
import { buildCourseColorMap, COURSE_PALETTE_SIZE, courseBgClass } from "./course-color"
import type { Course } from "@/providers/types"

function course(code: string, name = `课程${code}`): Course {
  return {
    code,
    name,
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    teacher: "",
    classroom: "",
    weeks: "1-16",
  } as Course
}

describe("buildCourseColorMap", () => {
  it("课程数不超过调色板大小时颜色互不相同", () => {
    const courses = Array.from({ length: COURSE_PALETTE_SIZE }, (_, i) => course(`C${100 + i}`))
    const map = buildCourseColorMap(courses)
    const indices = [...map.values()]
    expect(new Set(indices).size).toBe(COURSE_PALETTE_SIZE)
    for (const idx of indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(COURSE_PALETTE_SIZE)
    }
  })

  it("同 code 不同 name 的课程共享颜色，无 code 时按 name 区分", () => {
    const map = buildCourseColorMap([course("C1", "高等数学"), course("C1", "别的名字")])
    expect(map.size).toBe(1)

    const byName = buildCourseColorMap([course("", "高等数学"), course("", "大学英语")])
    expect(byName.get("高等数学")).not.toBe(byName.get("大学英语"))
  })

  it("课表增删课程不改变已分配课程的颜色", () => {
    const base = Array.from({ length: 6 }, (_, i) => course(`C${i}`))
    const before = buildCourseColorMap(base)

    const withAdded = buildCourseColorMap([...base, course("NEW")])
    for (const [key, idx] of before) {
      expect(withAdded.get(key)).toBe(idx)
    }

    const withRemoved = buildCourseColorMap(base.slice(1))
    for (const [key, idx] of before) {
      if (withRemoved.has(key)) expect(withRemoved.get(key)).toBe(idx)
    }
  })

  it("课程数超出调色板时回落哈希且索引始终有效", () => {
    const courses = Array.from({ length: 30 }, (_, i) => course(`C${i}`))
    const map = buildCourseColorMap(courses)
    expect(map.size).toBe(30)
    for (const idx of map.values()) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(COURSE_PALETTE_SIZE)
    }
  })

  it("分配结果与课程输入顺序无关", () => {
    const courses = Array.from({ length: COURSE_PALETTE_SIZE }, (_, i) => course(`C${i}`))
    const a = buildCourseColorMap(courses)
    const b = buildCourseColorMap([...courses].reverse())
    expect(new Map([...b].sort())).toEqual(new Map([...a].sort()))
  })
})

describe("courseBgClass", () => {
  it("返回 bg-schedule-N 形式的类名", () => {
    const map = buildCourseColorMap([course("C1")])
    expect(courseBgClass(map, course("C1"))).toMatch(/^bg-schedule-[1-8]$/)
  })

  it("映射缺失时仍返回有效类名", () => {
    const map = buildCourseColorMap([])
    expect(courseBgClass(map, course("C9"))).toMatch(/^bg-schedule-[1-8]$/)
  })
})
