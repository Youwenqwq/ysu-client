import { defineDictionary } from "@orahako/sdk"

export const announcementDictionary = defineDictionary({
  zh: {
    announcement: {
      levelInfo: "通知",
      levelWarning: "警告",
      levelCritical: "紧急",
      gotIt: "知道了",
      dismiss: "不再提醒",
      noContent: "暂无公告内容",
      dialogDescription: "应用公告",
    },
  },
  en: {
    announcement: {
      levelInfo: "Info",
      levelWarning: "Warning",
      levelCritical: "Critical",
      gotIt: "Got it",
      dismiss: "Don't remind again",
      noContent: "No announcement content",
      dialogDescription: "App announcement",
    },
  },
})

export type AnnouncementDictionary = typeof announcementDictionary
