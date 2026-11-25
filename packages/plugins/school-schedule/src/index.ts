import { CalendarDays } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  supportsPlugin,
  type ClassPeriod,
  type ClassroomInfo,
  type ClassroomQueryOptions,
  type CodeItem,
  type Course,
  type CurrentWeek,
  type MajorInfo,
  type ProviderQueryPolicy,
  type SchoolClassInfo,
  type SchoolClassQueryOptions,
  type TermCalendar,
} from "@orahako/academic-sdk"
import { createMinuteClockSource, createParameterizedQuerySource } from "@orahako/academic-kit"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginManifest,
  type RouteLocation,
} from "@orahako/sdk"
import { schoolScheduleDictionary, type SchoolScheduleDictionary } from "./dictionary"
import {
  SchoolScheduleHeaderActions,
  type SchoolScheduleHeaderActionsInject,
} from "./header-actions"
import {
  SchoolSchedulePage,
  type FreeRoomContext,
  type SchoolSchedulePageInject,
  type SchoolSchedulePageProps,
} from "./page"
import {
  FILTER_ALL,
  schoolScheduleFilterStore,
  type SchoolScheduleFilterState,
  type SchoolScheduleFilterStoreInstance,
  type SchoolScheduleTab,
  type SelectedClassroom,
  type SelectedSchoolClass,
} from "./store"
import "./slots"

export const SCHOOL_SCHEDULE_PLUGIN_ID = "orahako.school-schedule"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const SCHOOL_SCHEDULE_QUERY_POLICIES: Readonly<Record<string, ProviderQueryPolicy>> = {
  "current-week": { ttl: 12 * HOUR_MS, persist: true },
  "term-calendar": { ttl: 7 * DAY_MS, persist: true },
  "class-periods": { ttl: 7 * DAY_MS, persist: true },
  "school-grade-years": { ttl: 7 * DAY_MS, persist: true },
  "school-departments": { ttl: 7 * DAY_MS, persist: true },
  "school-majors": { ttl: 7 * DAY_MS, persist: true },
  "school-classes": { ttl: DAY_MS, persist: true },
  "school-class-schedule": { ttl: 7 * DAY_MS, persist: true },
  "school-campuses": { ttl: 7 * DAY_MS, persist: true },
  "school-buildings": { ttl: 7 * DAY_MS, persist: true },
  "school-classrooms": { ttl: 7 * DAY_MS, persist: true },
  "school-classroom-schedule": { ttl: 7 * DAY_MS, persist: true },
}

export type {
  FreeRoomContext,
  SchoolScheduleDictionary,
  SchoolScheduleFilterState,
  SchoolScheduleFilterStoreInstance,
  SchoolScheduleHeaderActionsInject,
  SchoolSchedulePageInject,
  SchoolSchedulePageProps,
  SchoolScheduleTab,
  SelectedClassroom,
  SelectedSchoolClass,
}

const schoolScheduleManifest: PluginManifest = {
  id: SCHOOL_SCHEDULE_PLUGIN_ID,
  name: "全校课表",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "查询行政班与教室的课表",
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query"],
}

export const schoolSchedulePlugin = definePlugin({
  manifest: schoolScheduleManifest,
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, slots, router, i18n, provider, session, query } = ctx
    i18n.register(schoolScheduleDictionary)
    for (const [feature, policy] of Object.entries(SCHOOL_SCHEDULE_QUERY_POLICIES)) {
      query.registerPolicy(feature, policy)
    }

    let disposed = false
    const filterStore = schoolScheduleFilterStore.create()
    const minuteClock = createMinuteClockSource()

    const isSchoolScheduleEnabled = (): boolean =>
      !disposed &&
      session.getSnapshot().isAuthenticated &&
      supportsPlugin(
        provider.getSnapshot().provider?.supportedPlugins,
        SCHOOL_SCHEDULE_PLUGIN_ID
      ) &&
      hasSlice(provider.getSnapshot().provider, "schoolSchedule")

    const currentWeekSource = query.source<CurrentWeek, "timetable">({
      feature: "current-week",
      slice: "timetable",
      enabled: () =>
        isSchoolScheduleEnabled() &&
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
        isSchoolScheduleEnabled() &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getTermCalendar),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getTermCalendar) {
          throw new Error("Term calendar query is unavailable")
        }
        return timetable.getTermCalendar()
      },
    })

    const periodsSource = query.source<ClassPeriod[], "timetable">({
      feature: "class-periods",
      slice: "timetable",
      enabled: () =>
        isSchoolScheduleEnabled() &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getClassPeriods),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getClassPeriods) {
          throw new Error("Class periods query is unavailable")
        }
        return timetable.getClassPeriods()
      },
    })

    const gradeYearsSource = query.source<CodeItem[], "schoolSchedule">({
      feature: "school-grade-years",
      slice: "schoolSchedule",
      enabled: isSchoolScheduleEnabled,
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "schoolSchedule").getSchoolGradeYears(),
    })

    const departmentsSource = query.source<CodeItem[], "schoolSchedule">({
      feature: "school-departments",
      slice: "schoolSchedule",
      enabled: isSchoolScheduleEnabled,
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "schoolSchedule").getSchoolDepartments(),
    })

    const majorsSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      string | undefined,
      MajorInfo[]
    >({
      state: filterStore.source,
      selectKey: (state) => (state.department === FILTER_ALL ? undefined : state.department),
      serializeKey: (department) => department ?? "",
      resolveSource: (department) =>
        query.source<MajorInfo[], "schoolSchedule">({
          feature: "school-majors",
          slice: "schoolSchedule",
          params: department,
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolMajors(department),
        }),
    })

    const classesSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      SchoolClassQueryOptions | null,
      SchoolClassInfo[]
    >({
      state: filterStore.source,
      selectKey: (state) => {
        if (state.selectedClass !== null) return null
        const hasFilter =
          state.grade !== FILTER_ALL ||
          state.department !== FILTER_ALL ||
          state.major !== FILTER_ALL
        if (!hasFilter) return null
        return {
          ...(state.grade !== FILTER_ALL ? { grade: state.grade } : {}),
          ...(state.department !== FILTER_ALL ? { department: state.department } : {}),
          ...(state.major !== FILTER_ALL ? { major: state.major } : {}),
        }
      },
      serializeKey: (filter) => JSON.stringify(filter),
      resolveSource: (filter) => {
        if (!filter) return null
        return query.source<SchoolClassInfo[], "schoolSchedule">({
          feature: "school-classes",
          slice: "schoolSchedule",
          params: filter,
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClasses(filter),
        })
      },
    })

    const classScheduleSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      string | null,
      Course[]
    >({
      state: filterStore.source,
      selectKey: (state) => state.selectedClass?.classId ?? null,
      serializeKey: (classId) => classId ?? "",
      resolveSource: (classId) => {
        if (!classId) return null
        return query.source<Course[], "schoolSchedule">({
          feature: "school-class-schedule",
          slice: "schoolSchedule",
          params: [classId, undefined],
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClassSchedule(classId),
        })
      },
    })

    const campusesSource = query.source<CodeItem[], "schoolSchedule">({
      feature: "school-campuses",
      slice: "schoolSchedule",
      enabled: isSchoolScheduleEnabled,
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "schoolSchedule").getSchoolCampuses(),
    })

    const buildingsSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      string | undefined,
      CodeItem[]
    >({
      state: filterStore.source,
      selectKey: (state) => (state.campus === FILTER_ALL ? undefined : state.campus),
      serializeKey: (campus) => campus ?? "",
      resolveSource: (campus) =>
        query.source<CodeItem[], "schoolSchedule">({
          feature: "school-buildings",
          slice: "schoolSchedule",
          params: campus,
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolBuildings(campus),
        }),
    })

    const roomsSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      ClassroomQueryOptions | null,
      ClassroomInfo[]
    >({
      state: filterStore.source,
      selectKey: (state) => {
        if (state.selectedRoom !== null) return null
        const hasFilter =
          state.searchedRoomName !== "" ||
          state.campus !== FILTER_ALL ||
          state.building !== FILTER_ALL
        if (!hasFilter) return null
        return {
          ...(state.searchedRoomName !== "" ? { name: state.searchedRoomName } : {}),
          ...(state.campus !== FILTER_ALL ? { campus: state.campus } : {}),
          ...(state.building !== FILTER_ALL ? { building: state.building } : {}),
        }
      },
      serializeKey: (filter) => JSON.stringify(filter),
      resolveSource: (filter) => {
        if (!filter) return null
        return query.source<ClassroomInfo[], "schoolSchedule">({
          feature: "school-classrooms",
          slice: "schoolSchedule",
          params: filter,
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClassrooms(filter),
        })
      },
    })

    const roomScheduleSource = createParameterizedQuerySource<
      SchoolScheduleFilterState,
      string | null,
      Course[]
    >({
      state: filterStore.source,
      selectKey: (state) => state.selectedRoom?.code ?? null,
      serializeKey: (code) => code ?? "",
      resolveSource: (code) => {
        if (!code) return null
        return query.source<Course[], "schoolSchedule">({
          feature: "school-classroom-schedule",
          slice: "schoolSchedule",
          params: [code, undefined],
          releaseOnInactive: true,
          enabled: isSchoolScheduleEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClassroomSchedule(code),
        })
      },
    })

    const isOwnPage = (location: RouteLocation) =>
      location.route === "school-schedule" || location.pluginId === SCHOOL_SCHEDULE_PLUGIN_ID

    // Keep the route hint from overriding a tab choice on repeated location emissions.
    let hadRoomTabHint = false
    const syncRouteTab = (location: RouteLocation) => {
      const hasRoomTabHint = isOwnPage(location) && location.params.tab === "room"
      const enteredRoomTab = hasRoomTabHint && !hadRoomTabHint
      hadRoomTabHint = hasRoomTabHint
      if (enteredRoomTab) filterStore.actions.setTab("room")
    }

    const changeTab = (tab: SchoolScheduleTab) => {
      if (filterStore.source.getSnapshot().tab === tab) return
      filterStore.actions.setTab(tab)
      const location = router.current.getSnapshot()
      if (!isOwnPage(location) || location.params.tab === undefined) return
      const search = new URLSearchParams(location.search)
      search.delete("tab")
      router.replace(`?${search.toString()}`)
    }
    const syncCurrentRouteTab = () => syncRouteTab(router.current.getSnapshot())
    const unsubscribeRouteTab = router.current.subscribe(syncCurrentRouteTab)
    syncCurrentRouteTab()

    router.registerBackGuard(() => {
      const location = router.current.getSnapshot()
      if (!isOwnPage(location)) return true
      const state = filterStore.source.getSnapshot()
      if (state.tab === "class" && state.selectedClass !== null) {
        filterStore.actions.selectClass(null)
        return false
      }
      if (state.tab === "room" && state.selectedRoom !== null) {
        filterStore.actions.selectRoom(null)
        return false
      }
      return true
    })

    ui.registerPage(
      {
        id: "index",
        route: "school-schedule",
        title: "全校课表",
        titleKey: "title",
        capability: "schoolSchedule",
        requiresProvider: true,
        dictionary: schoolScheduleDictionary,
        store: filterStore,
        inject: (): SchoolSchedulePageInject => ({
          onTabChange: changeTab,
          hooks: {
            location: router.current,
            clockTick: minuteClock.source,
            provider: provider.state,
            currentWeek: currentWeekSource,
            termCalendar: termCalendarSource,
            periods: periodsSource,
            gradeYears: gradeYearsSource,
            departments: departmentsSource,
            majors: majorsSource,
            classes: classesSource,
            classSchedule: classScheduleSource,
            campuses: campusesSource,
            buildings: buildingsSource,
            rooms: roomsSource,
            roomSchedule: roomScheduleSource,
          },
        }),
      },
      SchoolSchedulePage
    )

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "school-schedule-header-actions",
          slot: "shell.header.actions",
          order: 10,
          dictionary: schoolScheduleDictionary,
          store: filterStore,
          inject: (): SchoolScheduleHeaderActionsInject => ({
            hooks: {
              location: router.current,
              gradeYears: gradeYearsSource,
              departments: departmentsSource,
              majors: majorsSource,
              campuses: campusesSource,
              buildings: buildingsSource,
            },
            pluginId: SCHOOL_SCHEDULE_PLUGIN_ID,
          }),
        },
        SchoolScheduleHeaderActions
      )
    )

    ui.registerNavigation({
      id: "school-schedule",
      title: "全校课表",
      titleKey: "title",
      page: "index",
      icon: CalendarDays,
      group: "platform",
      order: 40,
      capability: "schoolSchedule",
    })

    ctx.effect(() => () => {
      disposed = true
      unsubscribeRouteTab()
      minuteClock.dispose()
      filterStore.dispose()
    })
  },
})

export default schoolSchedulePlugin
