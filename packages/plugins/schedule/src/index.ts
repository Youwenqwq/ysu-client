import { BookOpen, Calendar, Clock, LayoutGrid } from "lucide-react"
import {
  getSlice,
  hasSlice,
  requireSlice,
  supportsPlugin,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type ProviderQueryPolicy,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
  type TermCalendar,
} from "@orahako/academic-sdk"
import { createMinuteClockSource, createParameterizedQuerySource } from "@orahako/academic-kit"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type ObservableSource,
  type PluginManifest,
  type ScheduleCalendarContext,
  type ScheduleEntry,
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
import type { ScheduleItemFormTarget } from "./custom-dialogs"
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
  SCHEDULE_PAGE_CHILDREN,
  ScheduleHeaderActions,
  SchedulePage,
  type ScheduleHeaderActionsInject,
  type ScheduleHeaderActionsProps,
  type SchedulePageInject,
  type SchedulePageProps,
} from "./page"
import { ScheduleRegistry } from "./registry"
import {
  ClassReminderSettings,
  ScheduleStartupOption,
  ScheduleWidgetAssistantSettings,
  ScheduleWidgetsCategoryPanel,
  SCHEDULE_WIDGETS_CATEGORY_CHILDREN,
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
  computeEffectiveScheduleSnapshot,
  createSchedulePatchMutators,
  customItemToOverlayEntry,
  scheduleCustomizationsStore,
  schedulePatchesStore,
  scheduleSettingsStore,
  scheduleViewStore,
  type ActivePatchManager,
  type CustomScheduleItem,
  type CustomScheduleKind,
  type CustomScheduleRecurrence,
  type CustomScheduleTimeMode,
  type EffectiveScheduleSnapshot,
  type PendingPatchUndo,
  type PendingScheduleDrop,
  type ScheduleCustomizationsState,
  type ScheduleCustomizationsStoreInstance,
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
  CustomScheduleItem,
  CustomScheduleKind,
  CustomScheduleRecurrence,
  CustomScheduleTimeMode,
  EffectiveScheduleSnapshot,
  GeolocationCoordinatesSnapshot,
  MobileLessonBridge,
  PendingPatchUndo,
  PendingScheduleDrop,
  ScheduleAdjustmentsDialogView,
  ScheduleCustomizationsState,
  ScheduleCustomizationsStoreInstance,
  ScheduleDictionary,
  ScheduleDragSurfaceProps,
  ScheduleHeaderActionsInject,
  ScheduleHeaderActionsProps,
  ScheduleItemFormTarget,
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

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const SCHEDULE_QUERY_POLICIES: Readonly<Record<string, ProviderQueryPolicy>> = {
  schedule: { ttl: 7 * DAY_MS, persist: true },
  "current-week": { ttl: 12 * HOUR_MS, persist: true },
  "term-calendar": { ttl: 7 * DAY_MS, persist: true },
  "class-periods": { ttl: 7 * DAY_MS, persist: true },
}

const EMPTY_PROVIDER_SNAPSHOT: ProviderRuntimeSnapshot = {
  status: "unavailable",
  schoolId: null,
  provider: null,
  error: null,
  generation: 0,
}

const EMPTY_SESSION_SNAPSHOT: SessionSnapshot = {
  activeSchoolId: null,
  credential: null,
  username: null,
  isAuthenticated: false,
  sessionExpired: false,
  hasHydrated: true,
  artifacts: {},
}

const STATIC_PROVIDER_SOURCE: ObservableSource<ProviderRuntimeSnapshot> = {
  getSnapshot: () => EMPTY_PROVIDER_SNAPSHOT,
  subscribe: () => () => {},
}

const STATIC_SESSION_SOURCE: ObservableSource<SessionSnapshot> = {
  getSnapshot: () => EMPTY_SESSION_SNAPSHOT,
  subscribe: () => () => {},
}

function createStaticQuerySource<T>(): ObservableSource<QuerySnapshot<T>> {
  const snapshot: QuerySnapshot<T> = {
    status: "idle",
    data: undefined,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: null,
    refresh: async () => undefined,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
}

function parsePeriodClockMinutes(timeStr: string | undefined): number | undefined {
  if (!timeStr) return undefined
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr.trim())
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined
}

function detectLiveUpdateSupported(isNative: boolean): boolean {
  if (!isNative) return false
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") {
    return true
  }
  const match = /Android\s+(\d+)/i.exec(navigator.userAgent)
  if (!match) return true
  return Number(match[1]) >= 16
}

const SCHEDULE_INJECT = [
  "ui",
  "slots",
  "settings",
  "router",
  "i18n",
  "storage",
  "native",
  "widgets",
  "assets",
] as const

const SCHEDULE_OPTIONAL_INJECT = [
  "provider",
  "session",
  "query",
  "notifications",
  "overview",
] as const

const scheduleManifest: PluginManifest = {
  id: SCHEDULE_PLUGIN_ID,
  name: "日程",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "开放式日程引擎、个人日程与课表编辑、多源聚合、上课提醒与桌面小组件",
  provides: ["schedule"],
  nativeCapabilities: [
    NOTIFICATIONS_CORE_CAPABILITY,
    REMINDERS_CLASSES_CAPABILITY,
    WIDGETS_GENERIC_CAPABILITY,
    WIDGETS_SCHEDULE_CAPABILITY,
  ],
  inject: [...SCHEDULE_INJECT],
}

export const schedulePlugin = definePlugin({
  manifest: scheduleManifest,
  inject: SCHEDULE_INJECT,
  optionalInject: SCHEDULE_OPTIONAL_INJECT,
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
    if (query) {
      for (const [feature, policy] of Object.entries(SCHEDULE_QUERY_POLICIES)) {
        query.registerPolicy(feature, policy)
      }
    }

    const resolveWidgetAssetSrc = (fileName: string): string =>
      assets.url(`widgets/${fileName}`) ?? router.href(`/widgets/${fileName}`)
    const widgetAssistantSrc = resolveWidgetAssetSrc("buro.png")

    let disposed = false
    const registry = new ScheduleRegistry()
    ctx.set("schedule", registry)

    const settingsStore = scheduleSettingsStore.create(storage)
    const patchesStore = schedulePatchesStore.create(storage)
    const customizationsStore = scheduleCustomizationsStore.create(storage)
    const viewStore = scheduleViewStore.create()
    const minuteClock = createMinuteClockSource()

    // Register personal free-time & single-date custom items as a first-class schedule source.
    const personalEntriesSource = createObservableSource<readonly ScheduleEntry[]>([])
    const publishPersonalEntries = (): void => {
      if (disposed) return
      const items = customizationsStore.source.getSnapshot().customItems
      const entries = items
        .map((item) => customItemToOverlayEntry(item, SCHEDULE_PLUGIN_ID))
        .filter((entry): entry is ScheduleEntry => entry !== null)
      personalEntriesSource.set(entries)
    }
    const detachPersonalSource = customizationsStore.source.subscribe(publishPersonalEntries)
    publishPersonalEntries()

    const ownSchedule = registry.createScopedFacade(ctx, scheduleManifest)
    ownSchedule.registerSource({
      id: "personal",
      order: 20,
      category: "personal",
      entries: personalEntriesSource,
    })

    const providerStateSource = provider?.state ?? STATIC_PROVIDER_SOURCE
    const sessionStateSource = session?.state ?? STATIC_SESSION_SOURCE
    const staticCoursesSource = createStaticQuerySource<Course[]>()
    const staticWeekSource = createStaticQuerySource<CurrentWeek>()
    const staticCalendarSource = createStaticQuerySource<TermCalendar>()
    const staticPeriodsSource = createStaticQuerySource<ClassPeriod[]>()

    const isTimetableEnabled = (): boolean => {
      if (!provider || !session) return false
      const activeProvider = provider.getSnapshot().provider
      return (
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        supportsPlugin(activeProvider?.supportedPlugins, SCHEDULE_PLUGIN_ID) &&
        hasSlice(activeProvider, "timetable")
      )
    }

    const createScheduleSourceForTerm = (semester: string | undefined) =>
      query
        ? query.source<Course[], "timetable">({
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
        : staticCoursesSource

    const createCurrentWeekSourceForTerm = (semester: string | undefined) =>
      query
        ? query.source<CurrentWeek, "timetable">({
            feature: "current-week",
            slice: "timetable",
            params: semester ? { semester } : undefined,
            enabled: () =>
              isTimetableEnabled() &&
              Boolean(provider?.getSnapshot().provider?.slices.timetable?.getCurrentWeek),
            fetcher: async (activeProvider) => {
              const timetable = requireSlice(activeProvider, "timetable")
              if (!timetable.getCurrentWeek) {
                throw new Error("Current week query is unavailable")
              }
              return timetable.getCurrentWeek(semester ? { semester } : undefined)
            },
          })
        : staticWeekSource

    const createTermCalendarSourceForTerm = (semester: string | undefined) =>
      query
        ? query.source<TermCalendar, "timetable">({
            feature: "term-calendar",
            slice: "timetable",
            params: semester ? { semester } : undefined,
            enabled: () =>
              isTimetableEnabled() &&
              Boolean(provider?.getSnapshot().provider?.slices.timetable?.getTermCalendar),
            fetcher: async (activeProvider) => {
              const timetable = requireSlice(activeProvider, "timetable")
              if (!timetable.getTermCalendar) {
                throw new Error("Term calendar query is unavailable")
              }
              return timetable.getTermCalendar(semester ? { semester } : undefined)
            },
          })
        : staticCalendarSource

    const periodsSource = query
      ? query.source<ClassPeriod[], "timetable">({
          feature: "class-periods",
          slice: "timetable",
          enabled: () =>
            isTimetableEnabled() &&
            Boolean(provider?.getSnapshot().provider?.slices.timetable?.getClassPeriods),
          fetcher: async (activeProvider) => {
            const timetable = requireSlice(activeProvider, "timetable")
            if (!timetable.getClassPeriods) {
              throw new Error("Class periods query is unavailable")
            }
            return timetable.getClassPeriods()
          },
        })
      : staticPeriodsSource

    const defaultScheduleSource = createScheduleSourceForTerm(undefined)
    const defaultCurrentWeekSource = createCurrentWeekSourceForTerm(undefined)
    const defaultTermCalendarSource = createTermCalendarSourceForTerm(undefined)

    // Publish merged effective timetable courses (with overrides, patches, and
    // custom recurring courses) plus calendar/period metadata onto ScheduleService
    // so headless consumers & custom shells can read one unified schedule stream.
    const publishBaseSchedule = (): void => {
      if (disposed) return
      const providerSnap = providerStateSource.getSnapshot()
      const sessionSnap = sessionStateSource.getSnapshot()
      const rawCourses = defaultScheduleSource.getSnapshot().data
      const currentWeek = defaultCurrentWeekSource.getSnapshot().data ?? null
      const calendar = defaultTermCalendarSource.getSnapshot().data
      const periods = periodsSource.getSnapshot().data ?? []
      const periodMap = new Map(periods.map((period) => [period.section, period]))

      const effective = computeEffectiveScheduleSnapshot({
        rawCourses,
        calendar,
        currentWeek,
        providerSnapshot: providerSnap,
        sessionSnapshot: sessionSnap,
        patchesState: patchesStore.source.getSnapshot(),
        patchesHydrated: patchesStore.hydrated.getSnapshot(),
        customizationsState: customizationsStore.source.getSnapshot(),
        customizationsHydrated: customizationsStore.hydrated.getSnapshot(),
      })

      const customItemById = new Map(
        customizationsStore.source.getSnapshot().customItems.map((item) => [item.id, item])
      )

      const baseEntries: ScheduleEntry[] = effective.courses.map((course, index) => {
        const startPeriod = periodMap.get(course.startSection)
        const endPeriod = periodMap.get(course.endSection)
        const startMin = startPeriod?.startMinute ?? parsePeriodClockMinutes(startPeriod?.startTime)
        const endMin = endPeriod?.endMinute ?? parsePeriodClockMinutes(endPeriod?.endTime)
        const customItem = course.customItemId ? customItemById.get(course.customItemId) : undefined
        return {
          id:
            course.occurrenceId ||
            `course:${course.code || course.name}:${course.date}:${course.startSection}:${course.endSection}:${index}`,
          ...(course.courseKey ? { seriesId: course.courseKey } : {}),
          sourceId: "timetable",
          sourcePluginId: SCHEDULE_PLUGIN_ID,
          category: "course",
          title: course.name,
          ...(course.classroom ? { location: course.classroom } : {}),
          ...(course.teacher ? { subtitle: course.teacher } : {}),
          ...(course.deliveryMode ? { deliveryMode: course.deliveryMode } : {}),
          ...(course.note ? { note: course.note } : {}),
          ...(course.courseKey ? { colorKey: course.courseKey } : {}),
          ...(course.date ? { date: course.date } : {}),
          weekDay: course.weekDay,
          ...(course.weekList && course.weekList.length > 0 ? { weekList: course.weekList } : {}),
          sections: {
            startSection: course.startSection,
            endSection: course.endSection,
          },
          ...(startMin !== undefined && endMin !== undefined && endMin > startMin
            ? { time: { startMinute: startMin, endMinute: endMin } }
            : {}),
          remindable: customItem ? customItem.remindable !== false : true,
          metadata: {
            ...(course.code ? { courseCode: course.code } : {}),
            ...(course.credit ? { credit: course.credit } : {}),
            ...(course.patchIds.length > 0 ? { adjusted: true } : {}),
            ...(course.overridden ? { overridden: true } : {}),
            ...(course.customItemId ? { custom: true } : {}),
          },
        }
      })

      const timeZone =
        providerSnap.provider?.slices.timetable?.scheduleRules?.timeZone ??
        providerSnap.provider?.timeZone
      const normalizedPeriods = periods
        .filter((period) => Boolean(period.startTime && period.endTime))
        .map((period) => ({
          section: period.section,
          startTime: period.startTime!,
          endTime: period.endTime!,
          ...(period.name ? { name: period.name } : {}),
        }))
      const calendarContext: ScheduleCalendarContext | undefined =
        currentWeek || calendar || normalizedPeriods.length > 0 || timeZone
          ? {
              ...(currentWeek?.week !== undefined ? { currentWeek: currentWeek.week } : {}),
              ...(effective.totalWeeks > 0
                ? { totalWeeks: effective.totalWeeks }
                : calendar?.totalWeeks !== undefined
                  ? { totalWeeks: calendar.totalWeeks }
                  : {}),
              ...(currentWeek?.semester
                ? { semester: currentWeek.semester }
                : calendar?.semester
                  ? { semester: calendar.semester }
                  : {}),
              ...(effective.termStartDate ? { termStartDate: effective.termStartDate } : {}),
              ...(timeZone ? { timeZone } : {}),
              periods: normalizedPeriods,
            }
          : undefined

      registry.setBaseSchedule(baseEntries, calendarContext)
    }

    registry.setBaseRefresher(async () => {
      await Promise.allSettled([
        defaultScheduleSource.getSnapshot().refresh(),
        defaultCurrentWeekSource.getSnapshot().refresh(),
        defaultTermCalendarSource.getSnapshot().refresh(),
        periodsSource.getSnapshot().refresh(),
      ])
    })

    const baseSubscriptions = [
      defaultScheduleSource.subscribe(publishBaseSchedule),
      defaultCurrentWeekSource.subscribe(publishBaseSchedule),
      defaultTermCalendarSource.subscribe(publishBaseSchedule),
      periodsSource.subscribe(publishBaseSchedule),
      patchesStore.source.subscribe(publishBaseSchedule),
      patchesStore.hydrated.subscribe(publishBaseSchedule),
      customizationsStore.source.subscribe(publishBaseSchedule),
      customizationsStore.hydrated.subscribe(publishBaseSchedule),
      providerStateSource.subscribe(publishBaseSchedule),
      sessionStateSource.subscribe(publishBaseSchedule),
    ]
    publishBaseSchedule()

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

    const controller =
      provider && session
        ? new ClassReminderAndWidgetController({
            pluginId: SCHEDULE_PLUGIN_ID,
            settingsStore,
            patchesStore,
            customizationsStore,
            scheduleStateSource: registry.state,
            provider,
            session,
            native,
            widgets,
            scheduleSource: defaultScheduleSource,
            currentWeekSource: defaultCurrentWeekSource,
            termCalendarSource: defaultTermCalendarSource,
            periodsSource,
          })
        : null

    const patchMutators = createSchedulePatchMutators({
      patchesStore,
      getProviderSnapshot: () => provider?.getSnapshot() ?? EMPTY_PROVIDER_SNAPSHOT,
      getSessionSnapshot: () => session?.getSnapshot() ?? EMPTY_SESSION_SNAPSHOT,
    })

    const mobileBridge: MobileLessonBridge = {
      hasMobileSupport(): boolean {
        if (!provider) return false
        const activeProvider = provider.getSnapshot().provider
        return Boolean(getSlice(activeProvider, "timetable")?.mobile)
      },
      async getCurrentLesson(lessonQuery) {
        if (!provider) throw new Error("Mobile lesson service is unavailable")
        const mobile = requireSlice(provider.getActive(), "timetable").mobile
        if (!mobile) {
          throw new Error("Mobile lesson service is unavailable")
        }
        return mobile.getCurrentLesson(lessonQuery)
      },
      async getSigninContext(activityId, title) {
        if (!provider) throw new Error("Mobile sign-in service is unavailable")
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
        if (!provider) throw new Error("Mobile sign-in service is unavailable")
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

    const widgetsSettingsHref = router.href({
      route: "settings-category",
      params: { category: "widgets", expand: "add" },
    })

    const openWidgetsSettings = (): void => {
      router.push({
        route: "settings-category",
        params: { category: "widgets", expand: "add" },
      })
    }

    const openScheduleRoute = (): void => {
      router.push({ route: "schedule" })
    }

    if (notifications && controller) {
      notifications.registerChannel({
        id: "schedule",
        order: 30,
        slice: "timetable",
        onDisable: () => controller.handleChannelDisabled(),
        onEnable: () => controller.handleChannelEnabled(),
      })
    }

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
        primary: true,
        requiresProvider: false,
        dictionary: scheduleDictionary,
        children: SCHEDULE_PAGE_CHILDREN,
        store: viewStore,
        inject: (): SchedulePageInject => ({
          hooks: {
            clockTick: minuteClock.source,
            settings: settingsStore.source,
            patches: patchesStore.source,
            patchesHydrated: patchesStore.hydrated,
            customizations: customizationsStore.source,
            customizationsHydrated: customizationsStore.hydrated,
            scheduleState: registry.state,
            provider: providerStateSource,
            session: sessionStateSource,
            schedule: pageScheduleSource,
            currentWeek: pageCurrentWeekSource,
            termCalendar: pageTermCalendarSource,
            periods: periodsSource,
          },
          pluginId: SCHEDULE_PLUGIN_ID,
          patchMutators,
          upsertOverride: (scope, override) =>
            customizationsStore.actions.upsertOverride(scope, override),
          removeOverride: (scope, courseKey) =>
            customizationsStore.actions.removeOverride(scope, courseKey),
          upsertCustomItem: (item) => customizationsStore.actions.upsertCustomItem(item),
          removeCustomItem: (id) => customizationsStore.actions.removeCustomItem(id),
          onSemesterChange: (semester) => registry.setSemester(semester),
          refreshSources: () => registry.refreshAll(),
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
      primary: true,
    })

    const overviewWidgetInject = (): ScheduleOverviewWidgetInject => ({
      hooks: {
        clockTick: minuteClock.source,
        provider: providerStateSource,
        session: sessionStateSource,
        patchesHydrated: patchesStore.hydrated,
        customizations: customizationsStore.source,
        customizationsHydrated: customizationsStore.hydrated,
        scheduleState: registry.state,
        schedule: defaultScheduleSource,
        currentWeek: defaultCurrentWeekSource,
        termCalendar: defaultTermCalendarSource,
        periods: periodsSource,
      },
      scheduleHref: router.href({ route: "schedule" }),
      openSchedule: openScheduleRoute,
      mobileBridge,
    })

    overview?.registerWidget(
      {
        id: COURSE_PROGRESS_WIDGET_ID,
        title: "日程动态",
        titleKey: "overview.courseProgress.title",
        description: "显示正在进行或即将开始的课程与日程。",
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

    overview?.registerWidget(
      {
        id: TODAY_COURSES_WIDGET_ID,
        title: "今日日程",
        titleKey: "overview.todayCourses.title",
        description: "按时间顺序显示今天的课程与日程安排。",
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

    if (native.isNative) {
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
          children: SCHEDULE_WIDGETS_CATEGORY_CHILDREN,
          store: settingsStore,
          inject: (): ScheduleWidgetsCategoryInject => ({
            hooks: {
              provider: providerStateSource,
              location: router.current,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
            isNative: () => native.isNative,
            previewSrc: resolveWidgetAssetSrc("schedule.png"),
            requestPinWidget: (widgetId) => widgets.requestPin(widgetId),
          }),
        },
        ScheduleWidgetsCategoryPanel
      )
    }

    slots.inject("settings.startupOptions", () =>
      slots.register(
        {
          id: "startup-option",
          slot: "settings.startupOptions",
          order: 20,
          dictionary: scheduleDictionary,
          inject: (): ScheduleStartupOptionInject => ({
            hooks: {
              provider: providerStateSource,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
          }),
        },
        ScheduleStartupOption
      )
    )

    if (native.isNative) {
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
    }

    if (controller) {
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
                provider: providerStateSource,
                scheduledAlarms: controller.scheduledAlarms,
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
    }

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
              customizations: customizationsStore.source,
              customizationsHydrated: customizationsStore.hydrated,
              provider: providerStateSource,
              session: sessionStateSource,
              schedule: pageScheduleSource,
              currentWeek: pageCurrentWeekSource,
              termCalendar: pageTermCalendarSource,
            },
            pluginId: SCHEDULE_PLUGIN_ID,
            setCompactMode: (compact) => settingsStore.actions.setCompactMode(compact),
          }),
        },
        ScheduleHeaderActions
      )
    )

    ctx.effect(() => async () => {
      disposed = true
      for (const unsubscribe of baseSubscriptions) unsubscribe()
      detachPersonalSource()
      minuteClock.dispose()
      registry.dispose()
      try {
        await controller?.dispose()
      } finally {
        viewStore.dispose()
        customizationsStore.dispose()
        patchesStore.dispose()
        settingsStore.dispose()
      }
    })
  },
})

export default schedulePlugin
