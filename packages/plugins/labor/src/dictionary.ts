import { defineDictionary } from "@orahako/sdk"

export const laborDictionary = defineDictionary({
  zh: {
    labor: {
      nav: "劳动教育",
      title: "劳动教育",
      description: "劳动学分汇总、劳动记录与活动报名",
      totalHours: "累计时长",
      totalCredits: "总学分",
      hoursUnit: "小时",
      recordsTab: "劳动记录",
      activitiesTab: "活动报名",
      noRecords: "暂无劳动记录",
      noActivities: "暂无活动",
      hours: "时长",
      enrolled: "已报名",
      activityTime: "活动时间",
      enrollWindow: "报名时间",
      location: "地点",
      teacher: "组织老师",
    },
  },
  en: {
    labor: {
      nav: "Labor Education",
      title: "Labor Education",
      description: "Labor credit summary, records and activity enrollment",
      totalHours: "Total hours",
      totalCredits: "Total credits",
      hoursUnit: "hrs",
      recordsTab: "Records",
      activitiesTab: "Activities",
      noRecords: "No labor records",
      noActivities: "No activities",
      hours: "Hours",
      enrolled: "Enrolled",
      activityTime: "Activity time",
      enrollWindow: "Enrollment window",
      location: "Location",
      teacher: "Teacher",
    },
  },
})

export type LaborDictionary = typeof laborDictionary
