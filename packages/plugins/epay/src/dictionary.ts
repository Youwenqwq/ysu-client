import { defineDictionary } from "@orahako/sdk"

export const epayDictionary = defineDictionary({
  zh: {
    settings: {
      epayReminderTitle: "缴费提醒",
    },
    epay: {
      nav: "缴费查询",
      title: "缴费查询",
      unpaidTitle: "未缴费用",
      paidTitle: "已缴费用",
      unpaidTotal: "待缴合计",
      unpaidCount: "{count} 笔未缴",
      allPaid: "暂无待缴费用，全部已完成",
      empty: "查无缴费记录",
      remindLabel: "未缴自动提醒",
      remindDesc: "打开应用时自动检查并提醒未缴费用",
      loadFailed: "查询失败：{message}",
      errorGeneric: "暂时无法获取缴费数据",
      retry: "重试",
      refresh: "刷新",
      updatedAt: "更新于 {time}",
      noAccount: "未获取到学号，请重新登录",
      unpaidNotify: "你有 {count} 笔费用待缴纳，合计 ¥{total}",
      statusUnpaid: "未支付",
      statusPaid: "已支付",
      ssoUnavailable: "查询需登录教务统一身份账号，登录后自动展示缴费记录",
    },
  },
  en: {
    settings: {
      epayReminderTitle: "Fee Reminder",
    },
    epay: {
      nav: "Fee Status",
      title: "Fee Status",
      unpaidTitle: "Unpaid Fees",
      paidTitle: "Paid Fees",
      unpaidTotal: "Unpaid Total",
      unpaidCount: "{count} unpaid",
      allPaid: "No unpaid fees — all settled",
      empty: "No payment records found",
      remindLabel: "Unpaid reminder",
      remindDesc: "Check and remind unpaid fees when the app opens",
      loadFailed: "Query failed: {message}",
      errorGeneric: "Unable to load fee data",
      retry: "Retry",
      refresh: "Refresh",
      updatedAt: "Updated {time}",
      noAccount: "Student ID unavailable, please sign in again",
      unpaidNotify: "You have {count} unpaid fee(s), total ¥{total}",
      statusUnpaid: "Unpaid",
      statusPaid: "Paid",
      ssoUnavailable: "Sign in to the unified identity account to view your fee records",
    },
  },
})

export type EpayDictionary = typeof epayDictionary
