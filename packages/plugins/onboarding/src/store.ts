import { defineDictionary, defineStore, type StoreInstance } from "@orahako/sdk"

export const onboardingDictionary = defineDictionary({
  zh: {
    title: "初次设置",
    chooseSchool: "选择学校",
    online: "在线插件",
    loadingSchools: "正在获取在线学校…",
    discoveryFailed: "无法获取在线学校列表",
    moreSchools: "更多学校",
    schoolLocked: "确认后将无法更换学校",
    confirm: "确认并继续",
    installing: "正在获取",
    installFailed: "获取失败，请重试",
    permissions: "权限",
    notifications: "通知",
    exactAlarm: "精确提醒",
    battery: "后台运行",
    noPermissions: "暂无需要配置的权限",
    allow: "允许",
    enabled: "已允许",
    retry: "重试",
    skip: "跳过",
    finish: "完成",
  },
  en: {
    title: "Setup",
    chooseSchool: "Choose your school",
    online: "Online plugin",
    loadingSchools: "Loading online schools…",
    discoveryFailed: "Could not load online schools",
    moreSchools: "More schools",
    schoolLocked: "The school cannot be changed after confirmation",
    confirm: "Confirm and continue",
    installing: "Downloading",
    installFailed: "Download failed. Try again.",
    permissions: "Permissions",
    notifications: "Notifications",
    exactAlarm: "Exact reminders",
    battery: "Background activity",
    noPermissions: "No permissions to configure",
    allow: "Allow",
    enabled: "Allowed",
    retry: "Retry",
    skip: "Skip",
    finish: "Finish",
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
