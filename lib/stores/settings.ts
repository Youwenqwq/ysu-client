import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { UpdateChannel } from "../updater"
import { migrateLocalStorageKey, STORAGE_KEYS } from "../storage/keys"
import {
  createDefaultOverviewLayout,
  normalizeOverviewLayout,
  type OverviewLayout,
} from "@/app/dashboard/overview/layout-config"

migrateLocalStorageKey(STORAGE_KEYS.settings, STORAGE_KEYS.legacySettings)

export type CardStyle = "solid" | "translucent" | "glass"
export type BackgroundStyle = "overlay" | "blur-overlay"
export type LandingPage = "overview" | "schedule"

interface EpayAccountSettings {
  lastCheckedAt: number
}

interface SettingsState {
  updateMirror: string
  updateChannel: UpdateChannel
  backgroundImage: string
  backgroundOverlayOpacity: number
  backgroundStyle: BackgroundStyle
  backgroundBlurAmount: number
  cardStyle: CardStyle
  cardOpacity: number
  defaultLandingPage: LandingPage
  widgetSyncReminderHours: number
  widgetShowNextDaySchedule: boolean
  avatarImage: string
  customUserAgent: string
  customUserAgentEnabled: boolean
  customCerBaseUrl: string
  customJwxtBaseUrl: string
  schoolId: string
  scheduleCompactMode: boolean
  gpaVisible: boolean
  overviewLayout: OverviewLayout
  gradeGachaEnabled: boolean
  notifyEnabled: boolean
  notifyCheckInterval: number
  notifyGrades: boolean
  notifyExams: boolean
  notifyNetworkError: boolean
  classReminderEnabled: boolean
  classReminderMinutes: number
  classReminderDays: number
  analyticsConsent: boolean
  lastAnalyticsDate: string
  analyticsPromptVersion: string
  /** 缴费提醒检查时间，按学号隔离 */
  epayAccountSettings: Record<string, EpayAccountSettings>
  /** 学费未缴自动提醒开关 */
  epayNotifyEnabled: boolean
  hasHydrated: boolean
  setUpdateMirror: (mirror: string) => void
  setUpdateChannel: (channel: UpdateChannel) => void
  setBackgroundImage: (image: string) => void
  setBackgroundOverlayOpacity: (opacity: number) => void
  setBackgroundStyle: (style: BackgroundStyle) => void
  setBackgroundBlurAmount: (amount: number) => void
  setCardStyle: (style: CardStyle) => void
  setCardOpacity: (opacity: number) => void
  setDefaultLandingPage: (page: LandingPage) => void
  setWidgetSyncReminderHours: (hours: number) => void
  setWidgetShowNextDaySchedule: (v: boolean) => void
  setAvatarImage: (image: string) => void
  setCustomUserAgent: (ua: string) => void
  setCustomUserAgentEnabled: (v: boolean) => void
  setCustomCerBaseUrl: (url: string) => void
  setCustomJwxtBaseUrl: (url: string) => void
  setSchoolId: (id: string) => void
  setScheduleCompactMode: (v: boolean) => void
  setGpaVisible: (v: boolean) => void
  setOverviewLayout: (layout: OverviewLayout) => void
  setGradeGachaEnabled: (v: boolean) => void
  setNotifyEnabled: (v: boolean) => void
  setNotifyCheckInterval: (v: number) => void
  setNotifyGrades: (v: boolean) => void
  setNotifyExams: (v: boolean) => void
  setNotifyNetworkError: (v: boolean) => void
  setClassReminderEnabled: (v: boolean) => void
  setClassReminderMinutes: (v: number) => void
  setClassReminderDays: (v: number) => void
  setAnalyticsConsent: (v: boolean) => void
  setLastAnalyticsDate: (v: string) => void
  setAnalyticsPromptVersion: (v: string) => void
  setEpayNotifyEnabled: (v: boolean) => void
  setEpayLastCheckedAt: (username: string, ts: number) => void
  setHasHydrated: (v: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      updateMirror: "",
      updateChannel: "stable",
      backgroundImage: "",
      backgroundOverlayOpacity: 75,
      backgroundStyle: "overlay",
      backgroundBlurAmount: 20,
      cardStyle: "solid",
      cardOpacity: 100,
      defaultLandingPage: "overview",
      widgetSyncReminderHours: 24,
      widgetShowNextDaySchedule: false,
      avatarImage: "",
      customUserAgent: "",
      customUserAgentEnabled: false,
      customCerBaseUrl: "",
      customJwxtBaseUrl: "",
      schoolId: "ysu",
      scheduleCompactMode: false,
      gpaVisible: false,
      overviewLayout: createDefaultOverviewLayout(),
      gradeGachaEnabled: true,
      notifyEnabled: false,
      notifyCheckInterval: 60,
      notifyGrades: true,
      notifyExams: true,
      notifyNetworkError: false,
      classReminderEnabled: false,
      classReminderMinutes: 15,
      classReminderDays: 7,
      analyticsConsent: false,
      lastAnalyticsDate: "",
      analyticsPromptVersion: "",
      epayAccountSettings: {},
      epayNotifyEnabled: true,
      hasHydrated: false,
      setUpdateMirror: (updateMirror) => set({ updateMirror }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setBackgroundImage: (backgroundImage) => set({ backgroundImage }),
      setBackgroundOverlayOpacity: (backgroundOverlayOpacity) => set({ backgroundOverlayOpacity }),
      setBackgroundStyle: (backgroundStyle) => set({ backgroundStyle }),
      setBackgroundBlurAmount: (backgroundBlurAmount) => set({ backgroundBlurAmount }),
      setCardStyle: (cardStyle) => set({ cardStyle }),
      setCardOpacity: (cardOpacity) => set({ cardOpacity }),
      setDefaultLandingPage: (defaultLandingPage) => set({ defaultLandingPage }),
      setWidgetSyncReminderHours: (widgetSyncReminderHours) => set({ widgetSyncReminderHours }),
      setWidgetShowNextDaySchedule: (widgetShowNextDaySchedule) =>
        set({ widgetShowNextDaySchedule }),
      setAvatarImage: (avatarImage) => set({ avatarImage }),
      setCustomUserAgent: (customUserAgent) => set({ customUserAgent }),
      setCustomUserAgentEnabled: (customUserAgentEnabled) => set({ customUserAgentEnabled }),
      setCustomCerBaseUrl: (customCerBaseUrl) => set({ customCerBaseUrl }),
      setCustomJwxtBaseUrl: (customJwxtBaseUrl) => set({ customJwxtBaseUrl }),
      setSchoolId: (schoolId) => set({ schoolId }),
      setScheduleCompactMode: (scheduleCompactMode) => set({ scheduleCompactMode }),
      setGpaVisible: (gpaVisible) => set({ gpaVisible }),
      setOverviewLayout: (overviewLayout) =>
        set({ overviewLayout: normalizeOverviewLayout(overviewLayout) }),
      setGradeGachaEnabled: (gradeGachaEnabled) => set({ gradeGachaEnabled }),
      setNotifyEnabled: (notifyEnabled) => set({ notifyEnabled }),
      setNotifyCheckInterval: (notifyCheckInterval) => set({ notifyCheckInterval }),
      setNotifyGrades: (notifyGrades) => set({ notifyGrades }),
      setNotifyExams: (notifyExams) => set({ notifyExams }),
      setNotifyNetworkError: (notifyNetworkError) => set({ notifyNetworkError }),
      setClassReminderEnabled: (classReminderEnabled) => set({ classReminderEnabled }),
      setClassReminderMinutes: (classReminderMinutes) => set({ classReminderMinutes }),
      setClassReminderDays: (classReminderDays) => set({ classReminderDays }),
      setAnalyticsConsent: (analyticsConsent) => set({ analyticsConsent }),
      setLastAnalyticsDate: (lastAnalyticsDate) => set({ lastAnalyticsDate }),
      setAnalyticsPromptVersion: (analyticsPromptVersion) => set({ analyticsPromptVersion }),
      setEpayNotifyEnabled: (epayNotifyEnabled) => set({ epayNotifyEnabled }),
      setEpayLastCheckedAt: (username, ts) =>
        set((state) => ({
          epayAccountSettings: {
            ...state.epayAccountSettings,
            [username]: {
              lastCheckedAt: ts,
            },
          },
        })),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: createJSONStorage(() => localStorage),
      merge: (persisted, current) => {
        const saved: Partial<SettingsState> = {}
        if (typeof persisted === "object" && persisted !== null && !Array.isArray(persisted)) {
          // Only current preference keys survive hydration; retired preferences are discarded.
          for (const key of Object.keys(current) as (keyof SettingsState)[]) {
            if (typeof current[key] !== "function" && Object.hasOwn(persisted, key)) {
              Object.assign(saved, { [key]: (persisted as Record<string, unknown>)[key] })
            }
          }
        }
        return {
          ...current,
          ...saved,
          overviewLayout: normalizeOverviewLayout(saved.overviewLayout),
          hasHydrated: false,
        }
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          // Storage failures still permit the default layout after client hydration.
          queueMicrotask(() => useSettingsStore.getState().setHasHydrated(true))
          return
        }
        state?.setHasHydrated(true)
      },
    }
  )
)
