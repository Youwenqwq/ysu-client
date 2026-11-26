import { defineDictionary } from "@orahako/sdk"

export const ecardDictionary = defineDictionary({
  zh: {
    ecard: {
      nav: "一卡通余额",
      title: "一卡通余额",
      balance: "当前余额",
      balanceUnit: "元",
      cardNo: "卡号",
      validUntil: "有效期至",
      cardStatus: "卡状态",
      loadFailed: "查询失败：{message}",
      errorGeneric: "查询失败，请稍后重试",
      noAccount: "未获取到学号，请重新登录",
      noAuth: "未登录教务，无法查询一卡通",
      refresh: "刷新",
      retry: "重试",
      updatedAt: "更新于 {time}",
      notAvailable: "暂无可显示的一卡通信息",
      refreshFailed: "刷新失败，显示上次余额",
      unsupportedProvider: "当前学校暂不支持一卡通查询",
    },
    widget: {
      title: "一卡通余额",
      description: "查看一卡通余额，点击进入详情页。",
      loading: "加载中",
      unavailableShort: "不可用",
      staleShort: "未更新",
    },
  },
  en: {
    ecard: {
      nav: "E-Card Balance",
      title: "E-Card Balance",
      balance: "Current Balance",
      balanceUnit: "CNY",
      cardNo: "Card No.",
      validUntil: "Valid Until",
      cardStatus: "Status",
      loadFailed: "Query failed: {message}",
      errorGeneric: "Query failed, please try again later",
      noAccount: "Student ID unavailable, please sign in again",
      noAuth: "Not signed in to the unified identity, cannot query e-card",
      refresh: "Refresh",
      retry: "Retry",
      updatedAt: "Updated {time}",
      notAvailable: "No e-card info available",
      refreshFailed: "Refresh failed; showing last balance",
      unsupportedProvider: "E-card queries are unavailable for this school",
    },
    widget: {
      title: "E-Card Balance",
      description: "View your e-card balance and open details.",
      loading: "Loading",
      unavailableShort: "N/A",
      staleShort: "Stale",
    },
  },
})

export type EcardDictionary = typeof ecardDictionary
