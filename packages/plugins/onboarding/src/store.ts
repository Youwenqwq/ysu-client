import { defineDictionary, defineStore, type StoreInstance } from "@orahako/sdk"

export const onboardingDictionary = defineDictionary({
  zh: {
    brand: "酸橙盒",
    welcomeTitle: "欢迎使用酸橙盒",
    getStarted: "开始设置",
    title: "初次设置",
    beforeStartTitle: "开始之前",
    beforeStartDesc: "请先了解以下使用须知与隐私说明",
    termUnofficialTitle: "非官方第三方客户端",
    termUnofficialDesc: "与学校官方无隶属关系，课表、考试与成绩等数据请以学校教务系统为准。",
    termLocalTitle: "凭证仅保存于本地",
    termLocalDescNative: "学号、密码与登录态仅保存于当前设备本地，请求直连学校服务器。",
    termLocalDescWeb: "学号、密码与登录态仅保存于当前浏览器本地，请求经代理转发且不记录账号凭证。",
    termPluginsTitle: "外部插件说明",
    termPluginsDesc: "第三方插件由对应作者维护并运行于应用内，请仅安装来自可信来源的插件。",
    analyticsTitle: "参与匿名统计",
    analyticsDesc:
      "仅采集应用版本、屏幕分辨率与设备平台信息，不含个人身份或教务数据，可随时在设置中关闭。",
    agreeAndContinue: "同意并继续",
    chooseSchool: "选择你的学校",
    chooseSchoolDesc: "选择所属院校以接入对应的教务与校园服务",
    online: "在线插件",
    builtin: "内置",
    loadingSchools: "正在获取在线学校…",
    discoveryFailed: "无法获取在线学校列表",
    moreSchools: "探索更多学校",
    schoolLocked: "确认后将无法修改",
    confirm: "确认并继续",
    installing: "正在配置…",
    installFailed: "获取失败，请重试",
    permissions: "系统权限",
    permissionsDesc: "按需开启提醒与后台保活，随时可在系统设置中调整",
    notifications: "通知提醒",
    exactAlarm: "精确日程闹钟",
    battery: "后台稳定运行",
    noPermissions: "当前环境暂无需要配置的额外权限",
    allow: "开启",
    enabled: "已开启",
    retry: "重试",
    skip: "跳过",
    finish: "进入登录",
  },
  en: {
    brand: "Orahako",
    welcomeTitle: "Welcome to Orahako",
    getStarted: "Get Started",
    title: "Setup",
    beforeStartTitle: "Before you begin",
    beforeStartDesc: "Please review these usage notes and privacy details",
    termUnofficialTitle: "Unofficial third-party client",
    termUnofficialDesc:
      "Independent from your institution. Always verify schedules, exams, and grades against official systems.",
    termLocalTitle: "Credentials stay on your device",
    termLocalDescNative:
      "Your student ID, password, and session are stored locally on this device and connect directly to your school.",
    termLocalDescWeb:
      "Your student ID, password, and session stay in your browser. Requests are proxied without logging credentials.",
    termPluginsTitle: "Third-party plugins",
    termPluginsDesc:
      "External plugins are maintained by their authors. Only install plugins from sources you trust.",
    analyticsTitle: "Anonymous analytics",
    analyticsDesc:
      "Collects only app version, screen size, and platform info—never personal or academic data. You can disable this anytime in Settings.",
    agreeAndContinue: "Agree and continue",
    chooseSchool: "Choose your school",
    chooseSchoolDesc: "Select your institution to connect academic services",
    online: "Online plugin",
    builtin: "Built-in",
    loadingSchools: "Loading online schools…",
    discoveryFailed: "Could not load online schools",
    moreSchools: "Explore more schools",
    schoolLocked: "Cannot be changed after confirmation",
    confirm: "Confirm and continue",
    installing: "Configuring…",
    installFailed: "Download failed. Try again.",
    permissions: "Permissions",
    permissionsDesc: "Enable reminders and background sync as needed",
    notifications: "Notifications",
    exactAlarm: "Exact reminders",
    battery: "Background activity",
    noPermissions: "No extra permissions required in this environment",
    allow: "Allow",
    enabled: "Allowed",
    retry: "Retry",
    skip: "Skip",
    finish: "Continue to sign in",
  },
})

export type OnboardingDictionary = typeof onboardingDictionary

export interface OnboardingState {
  readonly completed: boolean
  readonly selectedSchoolId: string | null
}

export const onboardingStore = defineStore({
  init: (): OnboardingState => ({
    completed: false,
    selectedSchoolId: null,
  }),
  persist: {
    key: "onboarding",
    mode: "local",
    version: 1,
  },
  actions: {
    selectSchool(ctx, schoolId: string) {
      ctx.set((prev) => ({
        ...prev,
        selectedSchoolId: schoolId,
      }))
    },
    complete(ctx) {
      ctx.set((prev) => ({
        ...prev,
        completed: true,
      }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type OnboardingStoreInstance = StoreInstance<
  OnboardingState,
  typeof onboardingStore.spec.actions
>
