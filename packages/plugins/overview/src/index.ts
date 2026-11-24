import { CalendarDays, LayoutDashboard, UserRound } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  type CurrentWeek,
  type OverviewWidgetContribution,
  type StudentInfo,
  type TermCalendar,
} from "@orahako/academic-sdk"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type Context,
  type PluginI18nRegistryService,
  type PluginLocale,
  type PluginManifest,
} from "@orahako/sdk"
import { OverviewLayoutEditor, type OverviewEditorInject, type ResolvedWidgetMeta } from "./editor"
import {
  isWidgetSupportedByProvider,
  OVERVIEW_PAGE_CHILDREN,
  OVERVIEW_PROFILE_WIDGET_ID,
  OVERVIEW_WEEK_SUMMARY_WIDGET_ID,
  OverviewPage,
  type OverviewPageInject,
} from "./page"
import { OverviewRegistry, overviewWidgetSlotKey, resolveOverviewWidgetText } from "./registry"
import "./slots"
import {
  overviewDictionary,
  overviewLayoutStore,
  type OverviewDictionary,
  type OverviewLayoutState,
  type OverviewLayoutStoreInstance,
} from "./store"
import {
  OverviewQueryState,
  OverviewStartupOption,
  ProfileSummaryWidget,
  WeekSummaryWidget,
  type OverviewQueryLike,
} from "./widgets"

export const OVERVIEW_PLUGIN_ID = "orahako.overview"

export {
  isWidgetSupportedByProvider,
  OVERVIEW_PAGE_CHILDREN,
  OVERVIEW_PROFILE_WIDGET_ID,
  OVERVIEW_WEEK_SUMMARY_WIDGET_ID,
  overviewDictionary,
  OverviewLayoutEditor,
  overviewLayoutStore,
  OverviewPage,
  OverviewQueryState,
  OverviewRegistry,
  OverviewStartupOption,
  overviewWidgetSlotKey,
  ProfileSummaryWidget,
  resolveOverviewWidgetText,
  WeekSummaryWidget,
  type OverviewDictionary,
  type OverviewLayoutState,
  type OverviewLayoutStoreInstance,
  type OverviewQueryLike,
  type ResolvedWidgetMeta,
}

function isI18nRegistryService(value: unknown): value is PluginI18nRegistryService {
  return (
    typeof value === "object" &&
    value !== null &&
    "translate" in value &&
    typeof value.translate === "function"
  )
}

const overviewManifest: PluginManifest = {
  id: OVERVIEW_PLUGIN_ID,
  name: "总览",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "教务总览页、插件卡片注册服务与可视化布局编辑器",
  provides: ["overview"],
  inject: [
    "ui",
    "slots",
    "settings",
    "router",
    "navigation",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
  ],
}

export const overviewPlugin = definePlugin({
  manifest: overviewManifest,
  inject: [
    "ui",
    "slots",
    "settings",
    "router",
    "navigation",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
  ] as const,
  apply(ctx) {
    const { ui, slots, settings, router, navigation, i18n, storage, provider, session, query } = ctx
    i18n.register(overviewDictionary)
    let disposed = false

    const registry = new OverviewRegistry()
    ctx.set("overview", registry)

    const layoutStore = overviewLayoutStore.create(storage)
    const ownOverview = registry.createScopedFacade(ctx, overviewManifest, slots, storage)

    const openSettingsRoute = (): void => {
      if (navigation.resolve("settings")) {
        router.push({ route: "settings" })
      } else {
        router.push({ route: "me" })
      }
    }

    const openOverviewRoute = (): void => {
      router.push({ route: "overview" })
    }

    ui.registerPage(
      {
        id: "index",
        route: "overview",
        title: "总览",
        titleKey: "pageTitle",
        primary: true,
        requiresProvider: true,
        dictionary: overviewDictionary,
        children: OVERVIEW_PAGE_CHILDREN,
        store: layoutStore,
        inject: (fullCtx: Context): OverviewPageInject => {
          const rootI18n: unknown = fullCtx.root.get("i18n")
          const i18nRegistry = isI18nRegistryService(rootI18n) ? rootI18n : undefined
          return {
            hooks: {
              layoutHydrated: layoutStore.hydrated,
              widgets: registry.state,
              provider: provider.state,
            },
            pluginId: OVERVIEW_PLUGIN_ID,
            resolveWidgetTitle: (widget: OverviewWidgetContribution, locale: PluginLocale) =>
              resolveOverviewWidgetText(widget, "title", locale, i18nRegistry),
            openSettings: openSettingsRoute,
          }
        },
      },
      OverviewPage
    )

    ui.registerNavigation({
      id: "overview",
      title: "总览",
      titleKey: "pageTitle",
      page: "index",
      icon: LayoutDashboard,
      group: "main",
      order: 0,
      primary: true,
    })

    slots.inject("settings.startupOptions", () =>
      slots.register(
        {
          id: "startup-option",
          slot: "settings.startupOptions",
          order: 10,
          dictionary: overviewDictionary,
        },
        OverviewStartupOption
      )
    )

    settings.registerCategory(
      {
        id: "overview",
        order: 10,
        title: "总览",
        titleKey: "pageTitle",
        description: "自定义总览布局",
        descriptionKey: "layout.settingsDescription",
        icon: LayoutDashboard,
        dictionary: overviewDictionary,
        store: layoutStore,
        inject: (fullCtx: Context): OverviewEditorInject => {
          const rootI18n: unknown = fullCtx.root.get("i18n")
          const i18nRegistry = isI18nRegistryService(rootI18n) ? rootI18n : undefined
          return {
            hooks: {
              layoutHydrated: layoutStore.hydrated,
              widgets: registry.state,
              provider: provider.state,
            },
            pluginId: OVERVIEW_PLUGIN_ID,
            resolveWidgetMeta: (
              widget: OverviewWidgetContribution,
              locale: PluginLocale
            ): ResolvedWidgetMeta => ({
              title: resolveOverviewWidgetText(widget, "title", locale, i18nRegistry),
              description: resolveOverviewWidgetText(widget, "description", locale, i18nRegistry),
              icon: widget.icon,
              region: widget.region,
            }),
            openOverview: openOverviewRoute,
            openSettings: openSettingsRoute,
          }
        },
      },
      OverviewLayoutEditor
    )

    const studentInfoSource = query.source<StudentInfo, "studentProfile">({
      feature: "student-info",
      slice: "studentProfile",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        hasSlice(provider.getSnapshot().provider, "studentProfile"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "studentProfile").getStudentInfo(),
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

    const termCalendarSource = query.source<TermCalendar, "timetable">({
      feature: "term-calendar",
      slice: "timetable",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getTermCalendar),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getTermCalendar) {
          throw new Error("Term calendar query is unavailable")
        }
        return timetable.getTermCalendar()
      },
    })

    ownOverview.registerWidget(
      {
        id: OVERVIEW_PROFILE_WIDGET_ID,
        title: "个人信息",
        titleKey: "widgets.profile.title",
        description: "查看姓名、学号、学院与专业概览。",
        descriptionKey: "widgets.profile.description",
        icon: UserRound,
        region: "summary",
        defaultVisible: true,
        order: -10,
        slice: "studentProfile",
        dictionary: overviewDictionary,
        inject: () => ({
          hooks: {
            session: session.state,
            student: studentInfoSource,
          },
        }),
      },
      ProfileSummaryWidget
    )

    ownOverview.registerWidget(
      {
        id: OVERVIEW_WEEK_SUMMARY_WIDGET_ID,
        title: "周次",
        titleKey: "widgets.weekSummary.title",
        description: "查看当前教学周、星期与学期。",
        descriptionKey: "widgets.weekSummary.description",
        icon: CalendarDays,
        region: "summary",
        defaultVisible: true,
        order: 0,
        slice: "timetable",
        dictionary: overviewDictionary,
        inject: () => ({
          hooks: {
            currentWeek: currentWeekSource,
            termCalendar: termCalendarSource,
          },
        }),
      },
      WeekSummaryWidget
    )

    ctx.effect(() => () => {
      disposed = true
      layoutStore.dispose()
    })
  },
})

export default overviewPlugin
