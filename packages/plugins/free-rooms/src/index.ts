import { DoorOpen } from "lucide-react"
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
  type ProviderQueryPolicy,
  type TermCalendar,
} from "@orahako/academic-sdk"
import { createMinuteClockSource, createParameterizedQuerySource } from "@orahako/academic-kit"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginManifest,
  type RouteLocation,
} from "@orahako/sdk"
import type {
  FreeRoomQuerySlot,
  RoomAvailability,
  RoomAvailabilityStatus,
  TimePreset,
} from "./availability"
import {
  BuildingScheduleScanner,
  type BuildingScanState,
  type BuildingScanStatus,
} from "./building-scanner"
import { freeRoomsDictionary, type FreeRoomsDictionary } from "./dictionary"
import { FreeRoomsPage, type FreeRoomsPageInject, type FreeRoomsPageProps } from "./page"
import {
  FILTER_ALL,
  freeRoomsPrefsStore,
  freeRoomsViewStore,
  type FavoriteRoom,
  type FreeRoomsPrefsState,
  type FreeRoomsPrefsStoreInstance,
  type FreeRoomsViewState,
  type FreeRoomsViewStoreInstance,
  type SelectedFreeRoom,
} from "./store"

export const FREE_ROOMS_PLUGIN_ID = "orahako.free-rooms"

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const FREE_ROOMS_QUERY_POLICIES: Readonly<Record<string, ProviderQueryPolicy>> = {
  "current-week": { ttl: 12 * HOUR_MS, persist: true },
  "term-calendar": { ttl: 7 * DAY_MS, persist: true },
  "class-periods": { ttl: 7 * DAY_MS, persist: true },
  "school-campuses": { ttl: 7 * DAY_MS, persist: true },
  "school-buildings": { ttl: 7 * DAY_MS, persist: true },
  "school-classrooms": { ttl: 7 * DAY_MS, persist: true },
  "school-classroom-schedule": { ttl: 7 * DAY_MS, persist: true },
}

export type {
  BuildingScanState,
  BuildingScanStatus,
  FavoriteRoom,
  FreeRoomQuerySlot,
  FreeRoomsDictionary,
  FreeRoomsPageInject,
  FreeRoomsPageProps,
  FreeRoomsPrefsState,
  FreeRoomsPrefsStoreInstance,
  FreeRoomsViewState,
  FreeRoomsViewStoreInstance,
  RoomAvailability,
  RoomAvailabilityStatus,
  SelectedFreeRoom,
  TimePreset,
}

const FREE_ROOMS_INJECT = [
  "ui",
  "router",
  "i18n",
  "storage",
  "provider",
  "session",
  "query",
] as const

const freeRoomsManifest: PluginManifest = {
  id: FREE_ROOMS_PLUGIN_ID,
  name: "空教室",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "按教学楼与时段快速查找当前空闲的自习教室",
  inject: [...FREE_ROOMS_INJECT],
}

export const freeRoomsPlugin = definePlugin({
  manifest: freeRoomsManifest,
  inject: FREE_ROOMS_INJECT,
  apply(ctx) {
    const { ui, router, i18n, storage, provider, session, query } = ctx
    i18n.register(freeRoomsDictionary)
    for (const [feature, policy] of Object.entries(FREE_ROOMS_QUERY_POLICIES)) {
      query.registerPolicy(feature, policy)
    }

    let disposed = false
    const prefsStore = freeRoomsPrefsStore.create(storage)
    const viewStore = freeRoomsViewStore.create()
    const scanner = new BuildingScheduleScanner(storage.local)
    const minuteClock = createMinuteClockSource()

    const isFreeRoomsEnabled = (): boolean =>
      !disposed &&
      session.getSnapshot().isAuthenticated &&
      supportsPlugin(provider.getSnapshot().provider?.supportedPlugins, FREE_ROOMS_PLUGIN_ID) &&
      hasSlice(provider.getSnapshot().provider, "schoolSchedule")

    const currentWeekSource = query.source<CurrentWeek, "timetable">({
      feature: "current-week",
      slice: "timetable",
      enabled: () =>
        isFreeRoomsEnabled() &&
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
        isFreeRoomsEnabled() &&
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
        isFreeRoomsEnabled() &&
        Boolean(provider.getSnapshot().provider?.slices.timetable?.getClassPeriods),
      fetcher: async (activeProvider) => {
        const timetable = requireSlice(activeProvider, "timetable")
        if (!timetable.getClassPeriods) {
          throw new Error("Class periods query is unavailable")
        }
        return timetable.getClassPeriods()
      },
    })

    const campusesSource = query.source<CodeItem[], "schoolSchedule">({
      feature: "school-campuses",
      slice: "schoolSchedule",
      enabled: isFreeRoomsEnabled,
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "schoolSchedule").getSchoolCampuses(),
    })

    const buildingsSource = createParameterizedQuerySource<
      FreeRoomsPrefsState,
      string | undefined,
      CodeItem[]
    >({
      state: prefsStore.source,
      selectKey: (state) => (state.campus === FILTER_ALL ? undefined : state.campus),
      serializeKey: (campus) => campus ?? "",
      resolveSource: (campus) =>
        query.source<CodeItem[], "schoolSchedule">({
          feature: "school-buildings",
          slice: "schoolSchedule",
          params: campus,
          releaseOnInactive: true,
          enabled: isFreeRoomsEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolBuildings(campus),
        }),
    })

    const roomsSource = createParameterizedQuerySource<
      FreeRoomsPrefsState,
      ClassroomQueryOptions | null,
      ClassroomInfo[]
    >({
      state: prefsStore.source,
      selectKey: (state) => {
        if (state.building === FILTER_ALL) return null
        return {
          ...(state.campus !== FILTER_ALL ? { campus: state.campus } : {}),
          building: state.building,
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
          enabled: isFreeRoomsEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClassrooms(filter),
        })
      },
    })

    const selectedRoomScheduleSource = createParameterizedQuerySource<
      FreeRoomsViewState,
      string | null,
      Course[]
    >({
      state: viewStore.source,
      selectKey: (state) => state.selectedRoom?.code ?? null,
      serializeKey: (code) => code ?? "",
      resolveSource: (code) => {
        if (!code) return null
        return query.source<Course[], "schoolSchedule">({
          feature: "school-classroom-schedule",
          slice: "schoolSchedule",
          params: [code, undefined],
          releaseOnInactive: true,
          enabled: isFreeRoomsEnabled,
          fetcher: (activeProvider) =>
            requireSlice(activeProvider, "schoolSchedule").getSchoolClassroomSchedule(code),
        })
      },
    })

    const triggerBuildingScan: FreeRoomsPageInject["triggerBuildingScan"] = ({
      scopeKey,
      rooms,
      forceRefresh,
    }) => {
      if (!isFreeRoomsEnabled()) return
      void scanner.scanBuilding({
        scopeKey,
        rooms,
        forceRefresh,
        fetchRoomSchedule: async (code) => {
          const activeProvider = provider.getActive()
          return requireSlice(activeProvider, "schoolSchedule").getSchoolClassroomSchedule(code)
        },
      })
    }

    const isOwnPage = (location: RouteLocation) =>
      location.route === "free-rooms" || location.pluginId === FREE_ROOMS_PLUGIN_ID

    router.registerBackGuard(() => {
      const location = router.current.getSnapshot()
      if (!isOwnPage(location)) return true
      if (viewStore.source.getSnapshot().selectedRoom !== null) {
        viewStore.actions.selectRoom(null)
        return false
      }
      return true
    })

    ui.registerPage(
      {
        id: "index",
        route: "free-rooms",
        title: "空教室",
        titleKey: "title",
        capability: "schoolSchedule",
        requiresProvider: true,
        dictionary: freeRoomsDictionary,
        store: viewStore,
        inject: (): FreeRoomsPageInject => ({
          hooks: {
            clockTick: minuteClock.source,
            provider: provider.state,
            prefs: prefsStore.source,
            scan: scanner.state,
            currentWeek: currentWeekSource,
            termCalendar: termCalendarSource,
            periods: periodsSource,
            campuses: campusesSource,
            buildings: buildingsSource,
            rooms: roomsSource,
            selectedRoomSchedule: selectedRoomScheduleSource,
          },
          setCampus: (campus) => prefsStore.actions.setCampus(campus),
          setBuilding: (building) => prefsStore.actions.setBuilding(building),
          setOnlyFree: (onlyFree) => prefsStore.actions.setOnlyFree(onlyFree),
          toggleFavoriteRoom: (room) => prefsStore.actions.toggleFavoriteRoom(room),
          triggerBuildingScan,
          resetScan: () => scanner.reset(),
        }),
      },
      FreeRoomsPage
    )

    ui.registerNavigation({
      id: "free-rooms",
      title: "空教室",
      titleKey: "title",
      page: "index",
      icon: DoorOpen,
      group: "academic",
      order: 40,
      capability: "schoolSchedule",
    })

    ctx.effect(() => () => {
      disposed = true
      scanner.dispose()
      minuteClock.dispose()
      viewStore.dispose()
      prefsStore.dispose()
    })
  },
})

export default freeRoomsPlugin
