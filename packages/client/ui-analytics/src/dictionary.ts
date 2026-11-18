import { defineDictionary } from "@orahako/sdk"

export const analyticsDictionary = defineDictionary({
  zh: {
    analyticsPrompt: {
      title: "匿名统计",
      content:
        "是否参与匿名使用统计？数据仅包含 App 版本、屏幕分辨率和设备平台信息（User-Agent），用于帮助开发者适配机型，调试 Bug。不包含任何个人身份，设备唯一标识或教务数据。可随时在设置中关闭。",
      agree: "好的！",
      decline: "还是算了...",
    },
    settings: {
      analyticsTitle: "匿名统计",
      analyticsEnabled: "参与匿名统计",
      analyticsDesc: "帮助开发者了解平台信息，不会包含身份标识和隐私数据",
    },
  },
  en: {
    analyticsPrompt: {
      title: "Anonymous Analytics",
      content:
        "Participate in anonymous usage statistics? Data includes only app version, screen resolution, and device platform (User-Agent). No personal or academic data is collected. You can disable this in Settings at any time.",
      agree: "Agree",
      decline: "Decline",
    },
    settings: {
      analyticsTitle: "Anonymous Analytics",
      analyticsEnabled: "Participate in Anonymous Analytics",
      analyticsDesc:
        "Help developers understand platform information without including identifying information or private data.",
    },
  },
})

export type AnalyticsDictionary = typeof analyticsDictionary
