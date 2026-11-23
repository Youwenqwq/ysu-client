import { BookOpen, Calendar, Clock, LayoutGrid } from "lucide-react"
import {
  getSlice,
  hasSlice,
  requireSlice,
  supportsPlugin,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type Exam,
  type TermCalendar,
} from "@orahako/academic-sdk"
import { createMinuteClockSource, createParameterizedQuerySource } from "@orahako/academic-kit"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  pluginPageHref,
  type PluginManifest,
} from "@orahako/sdk"
import {
  ClassReminderAndWidgetController,
  NOTIFICATIONS_CORE_CAPABILITY,
  REMINDERS_CLASSES_CAPABILITY,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  type ClassAlarmConfig,
  type ClassReminderAndWidgetControllerOptions,
  type ScheduleSyncInput,
  type ScheduleWidgetId,
} from "./controller"
import { scheduleDictionary, type ScheduleDictionary } from "./dictionary"
import type { ScheduleDragSurfaceProps } from "./drag-surface"
import type { ScheduleAdjustmentsDialogView } from "./editor-dialogs"
import {
  resolveGeolocationCoordinates,
  type GeolocationCoordinatesSnapshot,
  type MobileLessonBridge,
} from "./modals"
import {
  COURSE_PROGRESS_WIDGET_ID,
  CourseProgressWidget,
  TODAY_COURSES_WIDGET_ID,
  TodayCoursesWidget,
  type CourseProgressWidgetProps,
  type ScheduleOverviewWidgetInject,
  type TodayCoursesWidgetProps,
} from "./overview-widgets"
import {
  ScheduleHeaderActions,
  SchedulePage,
  type FreeRoomTargetParams,
  type ScheduleHeaderActionsInject,
  type ScheduleHeaderActionsProps,
  type SchedulePageInject,
  type SchedulePageProps,
} from "./page"
import {
  ClassReminderSettings,
  ScheduleStartupOption,
  ScheduleWidgetAssistantSettings,
  ScheduleWidgetsCategoryPanel,
  type ClassReminderSettingsInject,
  type ClassReminderSettingsProps,
  type ScheduleStartupOptionInject,
  type ScheduleStartupOptionProps,
  type ScheduleWidgetAssistantSettingsInject,
  type ScheduleWidgetAssistantSettingsProps,
  type ScheduleWidgetsCategoryInject,
  type ScheduleWidgetsCategoryProps,
} from "./settings"
import "./slots"
import {
  createSchedulePatchMutators,
  schedulePatchesStore,
  scheduleSettingsStore,
  scheduleViewStore,
  type ActivePatchManager,
  type EffectiveScheduleSnapshot,
  type PendingPatchUndo,
  type PendingScheduleDrop,
  type SchedulePatchDraft,
  type SchedulePatchesState,
  type SchedulePatchesStoreInstance,
  type SchedulePatchMutationContext,
  type SchedulePatchMutators,
  type ScheduleSettingsState,
  type ScheduleSettingsStoreInstance,
  type ScheduleViewState,
  type ScheduleViewStoreInstance,
  type WidgetAssistantPosition,
} from "./stores"

export const SCHEDULE_PLUGIN_ID = "orahako.schedule"

export type {
  ActivePatchManager,
  ClassAlarmConfig,
  ClassReminderAndWidgetControllerOptions,
  ClassReminderSettingsInject,
  ClassReminderSettingsProps,
  CourseProgressWidgetProps,
  EffectiveScheduleSnapshot,
  FreeRoomTargetParams,
  GeolocationCoordinatesSnapshot,
  MobileLessonBridge,
  PendingPatchUndo,
  PendingScheduleDrop,
  ScheduleAdjustmentsDialogView,
  ScheduleDictionary,
  ScheduleDragSurfaceProps,
  ScheduleHeaderActionsInject,
  ScheduleHeaderActionsProps,
  ScheduleOverviewWidgetInject,
  SchedulePageInject,
  SchedulePageProps,
  SchedulePatchDraft,
  SchedulePatchesState,
  SchedulePatchesStoreInstance,
  SchedulePatchMutationContext,
  SchedulePatchMutators,
  ScheduleSettingsState,
  ScheduleSettingsStoreInstance,
  ScheduleStartupOptionInject,
  ScheduleStartupOptionProps,
  ScheduleSyncInput,
  ScheduleViewState,
  ScheduleViewStoreInstance,
  ScheduleWidgetAssistantSettingsInject,
  ScheduleWidgetAssistantSettingsProps,
  ScheduleWidgetId,
  ScheduleWidgetsCategoryInject,
  ScheduleWidgetsCategoryProps,
  TodayCoursesWidgetProps,
  WidgetAssistantPosition,
}

const SETTINGS_CATEGORY_HOST_PLUGIN_ID = "orahako.settings"

function detectLiveUpdateSupported(isNative: boolean): boolean {
  if (!isNative) return false
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") {
    return true
  }
  const match = /Android\s+(\d+)/i.exec(navigator.userAgent)
  if (!match) return true
  return Number(match[1]) >= 16
}

const scheduleManifest: PluginManifest = {
  id: SCHEDULE_PLUGIN_ID,
  name: "日程",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "课程与考试日程表、本地课表调整、上课提醒与桌面小组件",
  nativeCapabilities: [
    NOTIFICATIONS_CORE_CAPABILITY,
    REMINDERS_CLASSES_CAPABILITY,
    WIDGETS_GENERIC_CAPABILITY,
    WIDGETS_SCHEDULE_CAPABILITY,
  ],
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
    "overview",
    "native",
    "widgets",
    "assets",
  ],
}

export const schedulePlugin = definePlugin({
  manifest: scheduleManifest,
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
    "overview",
    "native",
    "widgets",
    "assets",
  ] as const,
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
      native,
      widgets,
      assets,
    } = ctx

    i18n.register(scheduleDictionary)

    const resolveWidgetAssetSrc = (fileName: string): string =>
      assets.url(`widgets/${fileName}`) ?? router.href(`/widgets/${fileName}`)
    const widgetAssistantSrc = resolveWidgetAssetSrc("buro.png")

    let disposed = false
    const settingsStore = scheduleSettingsStore.create(storage)
    const patchesStore = schedulePatchesStore.create(storage)
    const viewStore = scheduleViewStore.create()
    const minuteClock = createMinuteClockSource()

    const isTimetableEnabled = (): boolean => {
      const activeProvider = provider.getSnapshot().provider
      return (
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        supportsPlugin(activeProvider?.supportedPlugins, SCHEDULE_PLUGIN_ID) &&
        hasSlice(activeProvider, "timetable")
      )
    }

    const createScheduleSourceForTerm = (semester: string | undefined) =>
      query.source<Course[], "timetable">({
        feature: "schedule",
        slice: "timetable",
        params: {
          ...(semester ? { semester } : {}),
          courseCategory: "all",
          includeLabSchedule: true,
        },
        enabled: isTimetableEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "timetable").getSchedule({
            ...(semester ? { semester } : {}),
            courseCategory: "all",
            includeLabSchedule: true,
          }),
      })

    const createCurrentWeekSourceForTerm = (semester: string | undefined) =>
      query.source<CurrentWeek, "timetable">({
        feature: "current-week",
        slice: "timetable",
        params: semester ? { semester } : undefined,
        enabled: () =>
          isTimetableEnabled() &&
          Boolean(provider.getSnapshot().provider?.slices.timetable?.getCurrentWeek),
        fetcher: async (activeProvider) => {
          const timetable = requireSlice(activeProvider, "timetable")
          if (!timetable.getCurrentWeek) {
            throw new Error("Current week query is unavailable")
          }
          return timetable.getCurrentWeek(semester ? { semester } : undefined)
        },
      })

    const createTermCalendarSourceForTerm = (semester: string | undefined) =>
      query.source<TermCalendar, "timetable">({
        feature: "term-calendar",
        slice: "timetable",
        params: semester ? { semester } : undefined,
        enabled: () =>
          isTimetableEnabled() &&
          Boolean(provider.getSnapshot().provider?.slices.timetable?.getTermCalendar),
        fetcher: async (activeProvider) => {
          const timetable = requireSlice(activeProvider, "timetable")
          if (!timetable.getTermCalendar) {
            throw new Error("Term calendar query is unavailable")
          }
          return timetable.getTermCalendar(semester ? { semester } : undefined)
        },
      })

    const periodsSource = query.source<ClassPeriod[], "timetable">({
      feature: "class-periods",
      slice: "timetable",
      enabled: () =>
        isTimetableEnabled() &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getClassPeriods),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getClassPeriods) {
          throw new Error("Class periods query is unavailable")
        }
        return timetable.getClassPeriods()
      },
    })

    const createExamsSourceForTerm = (semester: string | undefined) =>
      query.source<Exam[], "exams">({
        feature: "exams",
        slice: "exams",
        params: semester ? { semester } : undefined,
        enabled: () =>
          isTimetableEnabled() &&
          hasSlice(provider.getSnapshot().provider, "exams"),
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "exams").getExams(semester ? { semester } : undefined),
      })

    const defaultScheduleSource = createScheduleSourceForTerm(undefined)
    const defaultCurrentWeekSource = createCurrentWeekSourceForTerm(undefined)
    const defaultTermCalendarSource = createTermCalendarSourceForTerm(undefined)

    const pageScheduleSource = createParameterizedQuerySource<
      ScheduleViewState,
      string | undefined,
      Course[]
    >({
      state: viewStore.source,
      selectKey: (s) => (s.queriedTerm ? s.queriedTerm : undefined),
      serializeKey: (semester) => semester ?? "",
      resolveSource: (semester) =>
        semester ? createScheduleSourceForTerm(semester) : defaultScheduleSource,
    })

    const pageCurrentWeekSource = createParameterizedQuerySource<
      ScheduleViewState,
      string | undefined,
      CurrentWeek
    >({
      state: viewStore.source,
      selectKey: (s) => (s.queriedTerm ? s.queriedTerm : undefined),
      serializeKey: (semester) => semester ?? "",
      resolveSource: (semester) =>
        semester ? createCurrentWeekSourceForTerm(semester) : defaultCurrentWeekSource,
    })

    const pageTermCalendarSource = createParameterizedQuerySource<
      ScheduleViewState,
      string | undefined,
      TermCalendar
    >({
      state: viewStore.source,
      selectKey: (s) => (s.queriedTerm ? s.queriedTerm : undefined),
      serializeKey: (semester) => semester ?? "",
      resolveSource: (semester) =>
        semester ? createTermCalendarSourceForTerm(semester) : defaultTermCalendarSource,
    })

    const pageExamsSource = createParameterizedQuerySource<
      ScheduleViewState,
      string | undefined,
      Exam[]
    >({
      state: viewStore.source,
      selectKey: (s) => (s.queriedTerm ? s.queriedTerm : undefined),
      serializeKey: (semester) => semester ?? "",
      resolveSource: (semester) => createExamsSourceForTerm(semester),
    })

    const controller = new ClassReminderAndWidgetController({
      pluginId: SCHEDULE_PLUGIN_ID,
      settingsStore,
      patchesStore,
      provider,
      session,
      native,
      widgets,
      scheduleSource: defaultScheduleSource,
      currentWeekSource: defaultCurrentWeekSource,
      termCalendarSource: defaultTermCalendarSource,
      periodsSource,
    })

    const patchMutators = createSchedulePatchMutators({
      patchesStore,
      getProviderSnapshot: () => provider.getSnapshot(),
      getSessionSnapshot: () => session.getSnapshot(),
    })

    const mobileBridge: MobileLessonBridge = {
      hasMobileSupport(): boolean {
        const activeProvider = provider.getSnapshot().provider
        return Boolean(getSlice(activeProvider, "timetable")?.mobile)
      },
      async getCurrentLesson(lessonQuery) {
        const mobile = requireSlice(provider.getActive(), "timetable").mobile
        if (!mobile) {
          throw new Error("Mobile lesson service is unavailable")
        }
        return mobile.getCurrentLesson(lessonQuery)
      },
      async getSigninContext(activityId, title) {
        const mobile = requireSlice(provider.getActive(), "timetable").mobile
        if (!mobile) {
          throw new Error("Mobile sign-in service is unavailable")
        }
        const [detail, status] = await Promise.all([
          mobile.getSigninDetail({ activityId, title }),
          mobile.getStudentSigninStatus({ activityId, title }),
        ])
        return { detail, status }
      },
      async signIn(input) {
        const mobile = requireSlice(provider.getActive(), "timetable").mobile
        if (!mobile) {
          throw new Error("Mobile sign-in service is unavailable")
        }
        const coords = await resolveGeolocationCoordinates(native, {
          required: input.requireLocation === true,
        })
        return mobile.doStudentSign({
          activityId: input.activityId,
          accuracy: input.accuracy ?? coords.accuracy,
          latitude: input.latitude ?? coords.latitude,
          longitude: input.longitude ?? coords.longitude,
          ...(input.code ? { code: input.code } : {}),
        })
      },
    }

    const widgetsSettingsHref = router.href(
      pluginPageHref(SETTINGS_CATEGORY_HOST_PLUGIN_ID, "category", { category: "widgets" })
    )

    const openWidgetsSettings = (): void => {
      router.push({
        pluginId: SETTINGS_CATEGORY_HOST_PLUGIN_ID,
        pageId: "category",
        params: { category: "widgets" },
      })
    }

    const openSchoolSchedule = (): void => {
      router.push({ route: "school-schedule" })
    }

    const openFreeRooms = (params: FreeRoomTargetParams): void => {
      router.push({
        route: "school-schedule",
        params: {
          tab: "room",
          week: params.week,
          ...(params.day !== undefined ? { day: params.day } : {}),
          ...(params.section !== undefined ? { section: params.section } : {}),
        },
      })
    }

    const openScheduleRoute = (): void => {
      router.push({ route: "schedule" })
    }

    notifications.registerChannel({
      id: "schedule",
      slice: "timetable",
      onDisable: () => controller.handleChannelDisabled(),
    })

    router.registerBackGuard(() => {
      const loc = router.current.getSnapshot()
      const onOwnPage = loc.route === "schedule" || loc.pluginId === SCHEDULE_PLUGIN_ID
      if (!onOwnPage) return true
      const viewState = viewStore.source.getSnapshot()
      if (viewState.showOriginal) {
        viewStore.actions.setShowOriginal(false)
        return false
      }
      if (viewState.editScope !== null) {
        viewStore.actions.finishEditing()
        return false
      }
      return true
    })

    ui.registerPage(
      {
        id: "index",
        route: "schedule",
        title: "日程",
        titleKey: "navTitle",
        capability: "timetable",
        primary: true,
        requiresProvider: true,
        dictionary: scheduleDictionary,
        store: viewStore,
        inject: (): SchedulePageInject => ({
          hooks: {
            clockTick: minuteClock.source,
            settings: settingsStore.source,
            patches: patchesStore.source,
            patchesHydrated: patchesStore.hydrated,
            provider: provider.state,
            session: session.state,
            schedule: pageScheduleSource,
            currentWeek: pageCurrentWeekSource,
            termCalendar: pageTermCalendarSource,
            periods: periodsSource,
            exams: pageExamsSource,
          },
          pluginId: SCHEDULE_PLUGIN_ID,
          patchMutators,
          mobileBridge,
          isNative: () => native.isNative,
          assistantSrc: widgetAssistantSrc,
          setCompactMode: (compact) => settingsStore.actions.setCompactMode(compact),
          setWidgetAssistantHidden: (hidden) =>
            settingsStore.actions.setWidgetAssistantHidden(hidden),
          setWidgetAssistantPosition: (pos) =>
            settingsStore.actions.setWidgetAssistantPosition(pos),
          requestPinScheduleWidget: () => widgets.requestPin("schedule"),
          widgetsSettingsHref,
          openWidgetsSettings,
          openSchoolSchedule,
          openFreeRooms,
        }),
      },
      SchedulePage
    )

    ui.registerNavigation({
      id: "schedule",
      title: "日程",
      titleKey: "navTitle",
      page: "index",
      icon: Calendar,
      group: "main",
      order: 10,
      capability: "timetable",
      primary: true,
    })

    const overviewWidgetInject = (): ScheduleOverviewWidgetInject => ({
      hooks: {
        clockTick: minuteClock.source,
        provider: provider.state,
        session: session.state,
        patchesHydrated: patchesStore.hydrated,
        schedule: defaultScheduleSource,
        currentWeek: defaultCurrentWeekSource,
        termCalendar: defaultTermCalendarSource,
        periods: periodsSource,
      },
      scheduleHref: router.href({ route: "schedule" }),
      openSchedule: openScheduleRoute,
      mobileBridge,
    })

    overview.registerWidget(
      {
        id: COURSE_PROGRESS_WIDGET_ID,
        title: "课程动态",
        titleKey: "overview.courseProgress.title",
        description: "有课时显示正在进行或下一节课程。",
        descriptionKey: "overview.courseProgress.description",
        icon: Clock,
        region: "content",
        defaultVisible: true,
        order: 40,
        slice: "timetable",
        dictionary: scheduleDictionary,
        store: patchesStore,
        inject: overviewWidgetInject,
      },
      CourseProgressWidget
    )

    overview.registerWidget(
      {
        id: TODAY_COURSES_WIDGET_ID,
        title: "今日课程",
        titleKey: "overview.todayCourses.title",
        description: "显示今天的课程与上课安排。",
        descriptionKey: "overview.todayCourses.description",
        icon: BookOpen,
        region: "content",
        defaultVisible: true,
        order: 50,
        slice: "timetable",
        dictionary: scheduleDictionary,
        store: patchesStore,
        inject: overviewWidgetInject,
      },
      TodayCoursesWidget
    )

    settings.registerCategory(
      {
        id: "widgets",
        order: 40,
        title: "小组件",
        titleKey: "settings.widgetsCategoryTitle",
        description: "添加与管理桌面小组件",
        descriptionKey: "settings.widgetsCategoryDesc",
        icon: LayoutGrid,
        dictionary: scheduleDictionary,
        store: settingsStore,
        inject: (): ScheduleWidgetsCategoryInject => ({
          hooks: {
            provider: provider.state,
          },
          pluginId: SCHEDULE_PLUGIN_ID,
          isNative: () => native.isNative,
          requestPinWidget: (widgetId) => widgets.requestPin(widgetId),
        }),
      },
      ScheduleWidgetsCategoryPanel
    )

    slots.inject("settings.startupOptions", () =>
      slots.register(
        {
          id: "startup-option",
          slot: "settings.startupOptions",
          order: 20,
          dictionary: scheduleDictionary,
          inject: (): ScheduleStartupOptionInject => ({
            hooks: {
              provider: provider.state,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
          }),
        },
        ScheduleStartupOption
      )
    )

    slots.inject("settings.widgets", () =>
      slots.register(
        {
          id: "widget-assistant",
          slot: "settings.widgets",
          order: 10,
          dictionary: scheduleDictionary,
          store: settingsStore,
          inject: (): ScheduleWidgetAssistantSettingsInject => ({
            isNative: () => native.isNative,
            assistantSrc: widgetAssistantSrc,
          }),
        },
        ScheduleWidgetAssistantSettings
      )
    )

    const checkExactAlarmPermission = () => controller.checkExactAlarmPermission()

    slots.inject("settings.notifications.reminders", () =>
      slots.register(
        {
          id: "class-reminder-settings",
          slot: "settings.notifications.reminders",
          order: 10,
          dictionary: scheduleDictionary,
          store: settingsStore,
          inject: (): ClassReminderSettingsInject => ({
            hooks: {
              provider: provider.state,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
            isNative: () => native.isNative,
            isLiveUpdateSupported: () => detectLiveUpdateSupported(native.isNative),
            toggleClassReminder: (enabled) => controller.setClassReminderEnabled(enabled),
            requestExactAlarmPermission: () => native.requestExactAlarmPermission(),
            checkExactAlarmPermission,
          }),
        },
        ClassReminderSettings
      )
    )

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "schedule-header-actions",
          slot: "shell.header.actions",
          order: 10,
          dictionary: scheduleDictionary,
          store: viewStore,
          inject: (): ScheduleHeaderActionsInject => ({
            hooks: {
              location: router.current,
              clockTick: minuteClock.source,
              settings: settingsStore.source,
              patches: patchesStore.source,
              patchesHydrated: patchesStore.hydrated,
              provider: provider.state,
              session: session.state,
              schedule: pageScheduleSource,
              currentWeek: pageCurrentWeekSource,
              termCalendar: pageTermCalendarSource,
              periods: periodsSource,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
            setCompactMode: (compact) => settingsStore.actions.setCompactMode(compact),
            openSchoolSchedule,
            openFreeRooms,
          }),
        },
        ScheduleHeaderActions
      )
    )

    ctx.effect(() => () => {
      disposed = true
      minuteClock.dispose()
      void controller.dispose()
      viewStore.dispose()
      patchesStore.dispose()
      settingsStore.dispose()
    })
  },
})

export default schedulePlugin
