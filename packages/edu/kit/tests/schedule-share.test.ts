import { describe, expect, it } from "vitest"
import type { Course, CurrentWeek, TermCalendar } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"
import { buildSharedSchedulePayload } from "../src/schedule-share"

describe("buildSharedSchedulePayload", () => {
  const calendar: TermCalendar = {
    semester: "2026-2027-1",
    startDate: "2026-09-07",
    totalWeeks: 18,
    teachingWeeks: 18,
    isInUse: true,
  }
  const currentWeek: CurrentWeek = {
    week: 3,
    weekday: 1,
    semester: "2026-2027-1",
  }

  const courses: Course[] = [
    {
      name: "高等数学",
      classroom: "东教 101",
      teacher: "张老师",
      weekDay: 1,
      startSection: 1,
      endSection: 2,
      weekList: [1, 2, 3],
    },
    {
      name: "高等数学",
      classroom: "东教 101",
      teacher: "张老师",
      weekDay: 1,
      startSection: 1,
      endSection: 2,
      weekList: [4, 5],
    },
  ]

  const extraEntries: ScheduleEntry[] = [
    {
      id: "personal:1",
      sourceId: "personal",
      sourcePluginId: "orahako.schedule",
      category: "personal",
      title: "社团例会",
      location: "活动中心",
      weekDay: 3,
      time: { startMinute: 19 * 60, endMinute: 20 * 60 + 30 },
    },
    {
      id: "exam:1",
      sourceId: "exams",
      sourcePluginId: "orahako.exams",
      category: "exam",
      title: "线性代数",
      location: "西教 302",
      date: "2026-11-12",
      weekDay: 4,
      time: { startMinute: 9 * 60, endMinute: 11 * 60 },
    },
  ]

  it("compacts identical course slots and excludes personal/exams by default", () => {
    const payload = buildSharedSchedulePayload({
      courses,
      extraEntries,
      currentWeek,
      calendar,
      now: new Date("2026-09-21T08:00:00+08:00"),
    })

    expect(payload.version).toBe(1)
    expect(payload.title).toBe("2026-2027-1 日程")
    expect(payload.busyOnly).toBe(false)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toMatchObject({
      title: "高等数学",
      location: "东教 101",
      subtitle: "张老师",
      category: "course",
      weekDay: 1,
      weekList: [1, 2, 3, 4, 5],
      startSection: 1,
      endSection: 2,
    })
  })

  it("supports busyOnly redaction and optional personal/exam inclusion with exam prefix", () => {
    const full = buildSharedSchedulePayload({
      courses,
      extraEntries,
      currentWeek,
      calendar,
      includePersonal: true,
      includeExams: true,
      examTitlePrefix: "【考试】",
    })
    expect(full.items).toHaveLength(3)
    expect(full.items.find((i) => i.category === "exam")?.title).toBe("【考试】线性代数")
    expect(full.items.find((i) => i.category === "event")?.title).toBe("社团例会")

    const busy = buildSharedSchedulePayload({
      courses,
      extraEntries,
      currentWeek,
      calendar,
      busyOnly: true,
      includePersonal: true,
      includeExams: true,
      busyLabel: "忙碌",
    })
    expect(busy.title).toBe("2026-2027-1 忙碌时段")
    expect(busy.busyOnly).toBe(true)
    expect(busy.items).toHaveLength(3)
    for (const item of busy.items) {
      expect(item.title).toBe("忙碌")
      expect(item.category).toBe("busy")
      expect(item.location).toBeUndefined()
      expect(item.subtitle).toBeUndefined()
    }
  })
})
