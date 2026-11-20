import type { ScheduleLabels } from "@orahako/academic-kit"
import { defineDictionary, type Translator } from "@orahako/sdk"

export const schoolScheduleDictionary = defineDictionary({
  zh: {
    title: "全校课表",
    description: "查询行政班与教室的课表",
    classTab: "班级课表",
    roomTab: "教室课表",
    grade: "年级",
    department: "院系",
    major: "专业",
    campus: "校区",
    building: "教学楼",
    all: "全部",
    searchClass: "查询班级",
    searchRoom: "查询教室",
    roomNamePlaceholder: "教室名称关键字...",
    noClasses: "未找到班级",
    noRooms: "未找到教室",
    noCourses: "该学期暂无课程",
    backToList: "返回列表",
    studentCount: "{count} 人",
    seats: "座位 {count}",
    sections: "第 {start}-{end} 节",
    selectHint: "选择筛选条件后查询",
    unscheduled: "未排课",
    singleSection: "第{section}节",
    freeRoomEntry: "查空教室",
    freeRoomContext: "正在查找第{week}周 · {weekday}第{section}节 的空教室",
    closeDialog: "关闭",
    weekdayNames: {
      "1": "星期一",
      "2": "星期二",
      "3": "星期三",
      "4": "星期四",
      "5": "星期五",
      "6": "星期六",
      "7": "星期日",
    },
    weekdayShort: {
      "1": "周一",
      "2": "周二",
      "3": "周三",
      "4": "周四",
      "5": "周五",
      "6": "周六",
      "7": "周日",
    },
    schedule: {
      weekShort: "第{week}周",
      currentWeekBadge: "当前第 {week} 周",
      weekPrev: "上一周",
      weekNext: "下一周",
      noData: "暂无日程数据",
      overlapCourses: "{count} 个课程",
      overlapDialogTitle: "{weekday} 第{section}节",
      weeks: "周次",
      sections: "节次",
      lunchBreak: "午休",
      dinnerBreak: "晚休",
      overlap: "冲突",
      examTag: "考试",
      examTime: "时间",
      examLocation: "地点",
      examSeat: "座位号",
      courseDetail: "课程详情",
      teacher: "教师",
      classroom: "教室",
    },
  },
  en: {
    title: "School Schedules",
    description: "Query schedules of administrative classes and classrooms",
    classTab: "Classes",
    roomTab: "Classrooms",
    grade: "Grade",
    department: "Department",
    major: "Major",
    campus: "Campus",
    building: "Building",
    all: "All",
    searchClass: "Search classes",
    searchRoom: "Search rooms",
    roomNamePlaceholder: "Room name keyword...",
    noClasses: "No classes found",
    noRooms: "No rooms found",
    noCourses: "No courses this term",
    backToList: "Back to list",
    studentCount: "{count} students",
    seats: "{count} seats",
    sections: "Sections {start}-{end}",
    selectHint: "Pick filters and search",
    unscheduled: "Not scheduled",
    singleSection: "Section {section}",
    freeRoomEntry: "Find free rooms",
    freeRoomContext: "Finding free rooms · week {week}, {weekday}, section {section}",
    closeDialog: "Close",
    weekdayNames: {
      "1": "Monday",
      "2": "Tuesday",
      "3": "Wednesday",
      "4": "Thursday",
      "5": "Friday",
      "6": "Saturday",
      "7": "Sunday",
    },
    weekdayShort: {
      "1": "Mon",
      "2": "Tue",
      "3": "Wed",
      "4": "Thu",
      "5": "Fri",
      "6": "Sat",
      "7": "Sun",
    },
    schedule: {
      weekShort: "W{week}",
      currentWeekBadge: "Current Week {week}",
      weekPrev: "Previous week",
      weekNext: "Next week",
      noData: "No schedule data",
      overlapCourses: "{count} courses",
      overlapDialogTitle: "{weekday} Section {section}",
      weeks: "Weeks",
      sections: "Sections",
      lunchBreak: "Lunch",
      dinnerBreak: "Dinner",
      overlap: "Overlap",
      examTag: "Exam",
      examTime: "Time",
      examLocation: "Location",
      examSeat: "Seat",
      courseDetail: "Course Details",
      teacher: "Teacher",
      classroom: "Classroom",
    },
  },
})

export type SchoolScheduleDictionary = typeof schoolScheduleDictionary

export function weekdayName(t: Translator<SchoolScheduleDictionary>, day: number): string {
  switch (day) {
    case 1:
      return t("weekdayNames.1")
    case 2:
      return t("weekdayNames.2")
    case 3:
      return t("weekdayNames.3")
    case 4:
      return t("weekdayNames.4")
    case 5:
      return t("weekdayNames.5")
    case 6:
      return t("weekdayNames.6")
    case 7:
      return t("weekdayNames.7")
    default:
      return String(day)
  }
}

export function buildSchoolScheduleLabels(t: Translator<SchoolScheduleDictionary>): ScheduleLabels {
  return {
    weekdayShort: [
      t("weekdayShort.1"),
      t("weekdayShort.2"),
      t("weekdayShort.3"),
      t("weekdayShort.4"),
      t("weekdayShort.5"),
      t("weekdayShort.6"),
      t("weekdayShort.7"),
    ],
    weekdayNames: [
      t("weekdayNames.1"),
      t("weekdayNames.2"),
      t("weekdayNames.3"),
      t("weekdayNames.4"),
      t("weekdayNames.5"),
      t("weekdayNames.6"),
      t("weekdayNames.7"),
    ],
    noData: t("schedule.noData"),
    lunchBreak: t("schedule.lunchBreak"),
    dinnerBreak: t("schedule.dinnerBreak"),
    overlap: t("schedule.overlap"),
    overlapDialogTitle: ({ weekday, section }) =>
      t("schedule.overlapDialogTitle", { weekday, section }),
    overlapCourses: ({ count }) => t("schedule.overlapCourses", { count }),
    weeks: t("schedule.weeks"),
    sections: t("schedule.sections"),
    examTag: t("schedule.examTag"),
    examTime: t("schedule.examTime"),
    examLocation: t("schedule.examLocation"),
    examSeat: t("schedule.examSeat"),
    closeDialog: t("closeDialog"),
  }
}
