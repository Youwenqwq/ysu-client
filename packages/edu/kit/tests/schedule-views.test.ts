import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { ClassPeriod, Course, CurrentWeek, Exam } from "@orahako/academic-sdk"
import { describe, expect, it } from "vitest"

import {
  ScheduleMobile,
  ScheduleTablet,
  buildCourseColorMap,
  computeExamBlocks,
  computeScheduleGridRows,
  expandScheduleCourses,
  type ScheduleLabels,
} from "../src"

const labels: ScheduleLabels = {
  weekdayShort: ["一", "二", "三", "四", "五", "六", "日"],
  weekdayNames: ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
  noData: "本周暂无课程",
  lunchBreak: "午休",
  dinnerBreak: "晚休",
  overlap: "重叠",
  overlapDialogTitle: ({ weekday, section }) => `${weekday} 第${section}节`,
  overlapCourses: ({ count }) => `共 ${count} 门课程`,
  weeks: "周次",
  sections: "节次",
  examTag: "考试",
  examTime: "考试时间",
  examLocation: "考试地点",
  examSeat: "座位号",
  closeDialog: "关闭",
  editor: {
    adjustmentMark: "调",
    dayAdjusted: "整天已调整",
    courseAdjusted: "课程已调整",
    dragDay: (date) => `调整 ${date}`,
    traceKind: {
      moved: "已调课",
      replaced: "已替换",
      cleared: "已停课",
    },
    movedTo: (date) => `调至 ${date}`,
  },
}

const periods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
  { section: 4, startTime: "10:55", endTime: "11:40", isInUse: true },
  { section: 5, startTime: "14:00", endTime: "14:45", isInUse: true },
  { section: 8, startTime: "16:55", endTime: "17:40", isInUse: true },
  { section: 9, startTime: "19:00", endTime: "19:45", isInUse: true },
]

const currentWeek: CurrentWeek = {
  week: 1,
  weekday: 1,
  date: "2026-08-31",
  weekStartDate: "2026-08-31",
}

const courses: Course[] = [
  {
    name: "高等数学",
    code: "M101",
    teacher: "张老师",
    classroom: "A101",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weekList: [1],
  },
  {
    name: "线性代数",
    code: "M102",
    weekDay: 2,
    startSection: 4,
    endSection: 4,
    weekList: [1],
  },
  {
    name: "大学物理",
    code: "P101",
    weekDay: 2,
    startSection: 4,
    endSection: 4,
    weekList: [1],
  },
]

const exams: Exam[] = [
  {
    name: "英语分级考",
    startAt: "2026-09-02T14:00:00",
    endAt: "2026-09-02T14:45:00",
    examLocation: "B202",
  },
]

describe("schedule grid break rules", () => {
  it("uses neutral defaults and lets a school configure its own break sections", () => {
    expect(computeScheduleGridRows(periods)).toMatchObject({
      lunchRow: null,
      dinnerRow: null,
    })
    expect(computeScheduleGridRows(periods, { lunchAfter: 1, dinnerAfter: 4 })).toMatchObject({
      lunchRow: 3,
      dinnerRow: 6,
    })
  })
})

describe("ScheduleMobile and ScheduleTablet pure-props views", () => {
  it("renders empty states using labels.noData when no courses, exams, or traces exist", () => {
    const emptyColors = buildCourseColorMap([])
    const mobileHtml = renderToStaticMarkup(
      createElement(ScheduleMobile, {
        courses: [],
        colorMap: emptyColors,
        periods,
        currentWeekday: 1,
        currentWeek,
        weekAnchor: currentWeek,
        selectedWeek: 1,
        termStartDate: "2026-08-31",
        nowMinutes: 500,
        labels,
      })
    )
    const tabletHtml = renderToStaticMarkup(
      createElement(ScheduleTablet, {
        courses: [],
        colorMap: emptyColors,
        periods,
        currentWeekday: 1,
        currentWeek,
        weekAnchor: currentWeek,
        selectedWeek: 1,
        termStartDate: "2026-08-31",
        nowMinutes: 500,
        labels,
      })
    )

    expect(mobileHtml).toContain("本周暂无课程")
    expect(tabletHtml).toContain("本周暂无课程")
  })

  it("renders courses, breaks, overlaps, exam blocks, and editor badges from props", () => {
    const colorMap = buildCourseColorMap(courses)
    const occurrences = expandScheduleCourses(courses, "2026-08-31", 2)
    const examBlocks = computeExamBlocks(
      exams,
      periods,
      currentWeek,
      1,
      "2026-08-31",
      "Asia/Shanghai"
    )
    const scheduleRules = {
      timeZone: "Asia/Shanghai",
      lunchAfter: 4,
      dinnerAfter: 8,
    }

    const mobileHtml = renderToStaticMarkup(
      createElement(ScheduleMobile, {
        courses: occurrences,
        exams,
        colorMap,
        periods,
        currentWeekday: 1,
        currentWeek,
        weekAnchor: currentWeek,
        selectedWeek: 1,
        termStartDate: "2026-08-31",
        nowMinutes: 500,
        labels,
        scheduleRules,
        editor: {
          enabled: true,
          editing: true,
          adjustedDates: new Set(["2026-08-31"]),
          adjustedCourses: new Set([occurrences[0]!.occurrenceId]),
          coursePatchIds: new Set(["p1"]),
          termStartDate: "2026-08-31",
          traces: [
            {
              patchId: "p1",
              date: "2026-09-03",
              startSection: 1,
              endSection: 2,
              kind: "moved",
              name: "高等数学",
              targetDate: "2026-08-31",
            },
          ],
          courses: occurrences,
        },
      })
    )

    const tabletHtml = renderToStaticMarkup(
      createElement(ScheduleTablet, {
        courses: occurrences.filter((c) => c.weekList?.includes(1)),
        examBlocks,
        colorMap,
        periods,
        currentWeekday: 1,
        currentWeek,
        weekAnchor: currentWeek,
        selectedWeek: 1,
        termStartDate: "2026-08-31",
        nowMinutes: 500,
        labels,
        scheduleRules,
      })
    )

    for (const html of [mobileHtml, tabletHtml]) {
      expect(html).toContain("高等数学")
      expect(html).toContain("A101")
      expect(html).toContain("午休")
      expect(html).toContain("晚休")
      expect(html).toContain("重叠")
      expect(html).toContain("考试")
      expect(html).toContain("英语分级考")
    }
    expect(mobileHtml).toContain("整天已调整")
    expect(mobileHtml).toContain("课程已调整")
    expect(mobileHtml).toContain('data-schedule-adjusted="day"')
    expect(mobileHtml).toContain('data-schedule-adjusted="course"')
    expect(mobileHtml).toContain("调至 2026-08-31")

    // Normal viewing mode hides cancelled/moved trace tombstones while keeping subtle bottom indicators
    const normalHtml = renderToStaticMarkup(
      createElement(ScheduleMobile, {
        courses: occurrences,
        exams,
        colorMap,
        periods,
        currentWeekday: 1,
        currentWeek,
        weekAnchor: currentWeek,
        selectedWeek: 1,
        termStartDate: "2026-08-31",
        nowMinutes: 500,
        labels,
        scheduleRules,
        editor: {
          enabled: false,
          editing: false,
          adjustedDates: new Set(["2026-08-31"]),
          adjustedCourses: new Set([occurrences[0]!.occurrenceId]),
          coursePatchIds: new Set(["p1"]),
          termStartDate: "2026-08-31",
          traces: [
            {
              patchId: "p1",
              date: "2026-09-03",
              startSection: 1,
              endSection: 2,
              kind: "cleared",
              name: "体育V",
              targetDate: "2026-09-03",
            },
          ],
          courses: occurrences,
        },
      })
    )
    expect(normalHtml).toContain('data-schedule-adjusted="day"')
    expect(normalHtml).toContain('data-schedule-adjusted="course"')
    expect(normalHtml).not.toContain("已停课")
    expect(normalHtml).not.toContain("体育V")
  })
})
