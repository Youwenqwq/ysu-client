import { defineDictionary } from "@orahako/sdk"

export const analyticsDictionary = defineDictionary({
  zh: {
    settings: {
      analyticsTitle: "匿名统计",
      analyticsEnabled: "参与匿名统计",
      analyticsDesc: "帮助开发者了解平台信息，不会包含身份标识和隐私数据",
    },
  },
  en: {
    settings: {
      analyticsTitle: "Anonymous Analytics",
      analyticsEnabled: "Participate in Anonymous Analytics",
      analyticsDesc:
        "Help developers understand platform information without including identifying information or private data.",
    },
  },
})

export type AnalyticsDictionary = typeof analyticsDictionary
