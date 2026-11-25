import { GraduationCap } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  type CurrentWeek,
  type GPAStats,
  type Grade,
  type GradeAnalyticsQueryOptions,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { gradesDictionary, type GradesDictionary } from "./dictionary"
import type { GachaTier, GradeLetterCandidate } from "./gpa-band"
import {
  GradesHeaderActions,
  type GradesHeaderActionsInject,
  type GradesHeaderActionsProps,
} from "./header-actions"
import {
  GpaSummaryWidget,
  RecentGradesWidget,
  type GpaSummaryWidgetInject,
  type RecentGradesWidgetInject,
} from "./overview-widget"
import {
  GradesPage,
  type GradeAnalyticsResult,
  type GradesPageInject,
  type GradesPageProps,
} from "./page"
import { createParameterizedQueryController } from "./query-source"
import { GradeNotificationContent, GradesSettingsPanel } from "./settings"
import "./slots"
import {
  gradeGachaStore,
  gradesSettingsStore,
  gradesViewStore,
  type GradeGachaState,
  type GradeGachaStoreInstance,
  type GradesSettingsState,
  type GradesSettingsStoreInstance,
  type GradesViewState,
  type GradesViewStoreInstance,
  type PendingGrade,
} from "./store"

export const GRADES_PLUGIN_ID = "orahako.grades"

const SHORT_TTL_MS = 1000 * 60 * 60 * 12
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24

export type {
  GachaTier,
  GradeAnalyticsResult,
  GradeGachaState,
  GradeGachaStoreInstance,
  GradeLetterCandidate,
  GpaSummaryWidgetInject,
  GradesDictionary,
  GradesHeaderActionsInject,
  GradesHeaderActionsProps,
  GradesPageInject,
  GradesPageProps,
  GradesSettingsState,
  GradesSettingsStoreInstance,
  GradesViewState,
  GradesViewStoreInstance,
  PendingGrade,
}

const gradesManifest: PluginManifest = {
  id: GRADES_PLUGIN_ID,
  name: "成绩",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "课程成绩查询、GPA 等级标尺、统计分布排名与新成绩抽卡",
  inject: [
    "ui",
    "slots",
    "settings",
    "router",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
    "notifications",
  ],
}

export const gradesPlugin = definePlugin({
  manifest: gradesManifest,
  inject: [
    "ui",
    "slots",
    "settings",
    "router",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
    "notifications",
  ] as const,
  optionalInject: ["overview"] as const,
  apply(ctx) {
    const {
      ui,
      slots,
      settings,
      router,
      i18n,
      storage,
      provider,
      session,
      query,
      notifications,
      overview,
    } = ctx

    i18n.register(gradesDictionary)
    let disposed = false

    query.registerPolicy("grades", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("gpa-stats", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("grade-statistics", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("grade-distribution", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("grade-ranking", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("current-week", { ttl: SHORT_TTL_MS, persist: true })

    const settingsStore = gradesSettingsStore.create(storage)
    const gachaStore = gradeGachaStore.create(storage)
    const viewStore = gradesViewStore.create()

    const unregisterChannel = notifications.registerChannel({
      id: "grades",
      order: 10,
      slice: "grades",
      toPollingFlag: (enabled) => ({
        checkGrades: enabled,
        grades: enabled,
      }),
    })

    const buildGradesSource = (courseName: string) =>
      query.source<Grade[], "grades">({
        feature: "grades",
        slice: "grades",
        params: courseName ? { courseName } : undefined,
        enabled: () =>
          !disposed &&
          session.getSnapshot().isAuthenticated &&
          hasSlice(provider.getSnapshot().provider, "grades"),
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "grades").getGrades(courseName ? { courseName } : undefined),
      })

    const defaultGradesSource = buildGradesSource("")
    const pageGradesController = createParameterizedQueryController<string, Grade[]>(
      "",
      buildGradesSource
    )

    const gpaSource = query.source<GPAStats, "grades">({
      feature: "gpa-stats",
      slice: "grades",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(provider.getSnapshot().provider?.slices.grades?.getGPAStats),
      fetcher: async (activeProvider) => {
        const gradesSlice = requireSlice(activeProvider, "grades")
        if (!gradesSlice.getGPAStats) {
          throw new Error("GPA stats query is unavailable")
        }
        return gradesSlice.getGPAStats()
      },
    })

    const currentWeekSource = query.source<CurrentWeek, "timetable">({
      feature: "current-week",
      slice: "timetable",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getCurrentWeek),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getCurrentWeek) {
          throw new Error("Current week query is unavailable")
        }
        return timetable.getCurrentWeek()
      },
    })

    const fetchGradeAnalytics = async (
      params: GradeAnalyticsQueryOptions
    ): Promise<GradeAnalyticsResult> => {
      const activeProvider = provider.getSnapshot().provider
      const gradesSlice = activeProvider?.slices.grades
      if (!gradesSlice) {
        return { statistics: null, distribution: null, ranking: null }
      }
      const [statistics, distribution, ranking] = await Promise.all([
        gradesSlice.getGradeStatistics
          ? gradesSlice.getGradeStatistics(params).catch(() => null)
          : Promise.resolve(null),
        gradesSlice.getGradeDistribution
          ? gradesSlice.getGradeDistribution(params).catch(() => null)
          : Promise.resolve(null),
        gradesSlice.getGradeRanking
          ? gradesSlice.getGradeRanking(params).catch(() => null)
          : Promise.resolve(null),
      ])
      return { statistics, distribution, ranking }
    }

    overview?.registerWidget(
      {
        id: "gpa-summary",
        title: "初始绩点",
        titleKey: "grades.gpaInitial",
        description: "查看初始绩点、加权平均与算术平均。",
        descriptionKey: "widgets.gpaSummary.description",
        icon: GraduationCap,
        region: "summary",
        defaultVisible: false,
        order: 20,
        slice: "grades",
        dictionary: gradesDictionary,
        store: settingsStore,
        inject: (): GpaSummaryWidgetInject => ({
          hooks: { gpa: gpaSource },
        }),
      },
      GpaSummaryWidget
    )

    overview?.registerWidget(
      {
        id: "recent-grades",
        title: "近期成绩",
        titleKey: "widgets.recentGrades.title",
        description: "查看最近发布的课程成绩与绩点概览。",
        descriptionKey: "widgets.recentGrades.description",
        icon: GraduationCap,
        region: "content",
        defaultVisible: false,
        order: 70,
        slice: "grades",
        dictionary: gradesDictionary,
        store: settingsStore,
        inject: (): RecentGradesWidgetInject => ({
          hooks: {
            session: session.state,
            grades: defaultGradesSource,
            gpa: gpaSource,
            gacha: gachaStore.source,
          },
          openGrades: () => {
            router.push({ route: "grades" })
          },
        }),
      },
      RecentGradesWidget
    )

    settings.registerCategory(
      {
        id: "grades",
        order: 30,
        title: "成绩",
        titleKey: "navTitle",
        description: "新成绩抽卡",
        descriptionKey: "settings.gradeGachaDesc",
        icon: GraduationCap,
        dictionary: gradesDictionary,
        store: settingsStore,
      },
      GradesSettingsPanel
    )

    slots.inject("settings.notifications.content", () =>
      slots.register(
        {
          id: "grades",
          slot: "settings.notifications.content",
          order: 10,
          dictionary: gradesDictionary,
          inject: () => ({
            hooks: {
              provider: provider.state,
            },
          }),
        },
        GradeNotificationContent
      )
    )

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "grades-header-actions",
          slot: "shell.header.actions",
          dictionary: gradesDictionary,
          store: viewStore,
          inject: (): GradesHeaderActionsInject => ({
            hooks: { location: router.current, provider: provider.state },
            pluginId: GRADES_PLUGIN_ID,
          }),
        },
        GradesHeaderActions
      )
    )

    ui.registerPage(
      {
        id: "index",
        route: "grades",
        title: "成绩",
        titleKey: "navTitle",
        capability: "grades",
        primary: true,
        requiresProvider: true,
        dictionary: gradesDictionary,
        store: settingsStore,
        inject: (): GradesPageInject => ({
          hooks: {
            session: session.state,
            provider: provider.state,
            grades: pageGradesController.source,
            gpa: gpaSource,
            currentWeek: currentWeekSource,
            gacha: gachaStore.source,
            gachaHydrated: gachaStore.hydrated,
            view: viewStore.source,
          },
          viewActions: viewStore.actions,
          searchByCourseName: async (nextCourseName: string) => {
            const trimmed = nextCourseName.trim()
            if (trimmed === pageGradesController.getParams()) {
              await pageGradesController.refresh()
              return
            }
            pageGradesController.setParams(trimmed)
          },
          fetchGradeAnalytics,
          stageGachaGrades: (username, grades, gachaEnabled) => {
            gachaStore.actions.stageGrades(username, grades, gachaEnabled)
          },
          commitGachaPending: (username) => {
            gachaStore.actions.commitPending(username)
          },
        }),
      },
      GradesPage
    )

    ui.registerNavigation({
      id: "grades",
      title: "成绩",
      titleKey: "navTitle",
      page: "index",
      icon: GraduationCap,
      group: "main",
      order: 20,
      capability: "grades",
      primary: true,
    })

    ctx.effect(() => () => {
      disposed = true
      unregisterChannel()
      pageGradesController.dispose()
      settingsStore.dispose()
      gachaStore.dispose()
      viewStore.dispose()
    })
  },
})

export default gradesPlugin
