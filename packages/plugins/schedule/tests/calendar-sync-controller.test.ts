import { describe, expect, it, vi } from "vitest"
import type {
  Course,
  CurrentWeek,
  ProviderRuntimeService,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  SchoolProvider,
  SessionService,
  SessionSnapshot,
  TermCalendar,
} from "@orahako/academic-sdk"
import { createWidgetService } from "@orahako/runtime-native"
import {
  createObservableSource,
  type PluginKeyValueStorage,
  type PluginNativeService,
  type PluginStorageService,
} from "@orahako/sdk"
import { CALENDAR_SYNC_NAMESPACE, ClassReminderAndWidgetController } from "../src/controller"
import { schedulePatchesStore, scheduleSettingsStore } from "../src/stores"

function createMemoryKv(): PluginKeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

function createFakeProvider(): SchoolProvider {
  return {
    id: "ysu",
    name: "YSU",
    supportedPlugins: ["orahako.schedule"],
    slices: {
      timetable: {
        getSchedule: async () => [],
      },
    },
  } as unknown as SchoolProvider
}

function makeQuerySnapshot<T>(data: T): QuerySnapshot<T> {
  return {
    status: "success",
    data,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: 1,
    refresh: async () => data,
  }
}

describe("ClassReminderAndWidgetController on-demand calendar sync", () => {
  it("persists sync digest, skips redundant cold-start syncs, isolates namespace, and preserves calendar on dispose", async () => {
    const localBackend = createMemoryKv()
    const storage: PluginStorageService = {
      local: localBackend,
      secure: createMemoryKv(),
    }
    const invokeCalls: Array<{ id: string; method: string; payload?: Record<string, unknown> }> = []

    const native: PluginNativeService = {
      isNative: true,
      capabilities: {
        list: () => [
          {
            id: "calendar.sync",
            version: 1,
            methods: ["checkPermissions", "requestPermissions", "sync", "clear"],
          },
          { id: "reminders.classes", version: 1, methods: ["schedule", "cancel"] },
        ],
        has: (id) => id === "calendar.sync@1" || id === "reminders.classes@1",
        acquire: async () => async () => {},
        invoke: async <T>(
          id: string,
          method: string,
          payload?: Record<string, unknown>
        ): Promise<T> => {
          invokeCalls.push({ id, method, payload })
          if (
            id === "calendar.sync@1" &&
            (method === "checkPermissions" || method === "requestPermissions")
          ) {
            return { granted: true } as T
          }
          return { synced: 1, cleared: true } as T
        },
      },
      saveImage: async () => ({ uri: "" }),
      requestNotificationPermission: async () => true,
      requestExactAlarmPermission: async () => true,
      requestBatteryOptimizationExemption: async () => true,
    }

    const widgets = createWidgetService(native)

    const providerSource = createObservableSource<ProviderRuntimeSnapshot>({
      status: "ready",
      schoolId: "ysu",
      generation: 1,
      provider: createFakeProvider(),
      error: null,
    })
    const provider: ProviderRuntimeService = {
      state: providerSource,
      getSnapshot: () => providerSource.getSnapshot(),
      setActiveProvider: async () => {},
    } as unknown as ProviderRuntimeService

    const sessionSource = createObservableSource<SessionSnapshot>({
      isAuthenticated: true,
      activeSchoolId: "ysu",
      username: "20240001",
      credential: "token",
      artifacts: {},
      sessionExpired: false,
      hasHydrated: true,
    })
    const session: SessionService = {
      state: sessionSource,
      getSnapshot: () => sessionSource.getSnapshot(),
    } as unknown as SessionService

    const courses: Course[] = [
      {
        name: "高等数学",
        classroom: "A101",
        weekDay: 1,
        startSection: 1,
        endSection: 2,
        weekList: [1],
        weeks: "1",
        scheduleId: "c1",
      },
    ]
    const scheduleSource = createObservableSource<QuerySnapshot<Course[]>>(
      makeQuerySnapshot(courses)
    )
    const currentWeekSource = createObservableSource<QuerySnapshot<CurrentWeek>>(
      makeQuerySnapshot({ week: 1, weekday: 1 })
    )
    const termCalendarSource = createObservableSource<QuerySnapshot<TermCalendar>>(
      makeQuerySnapshot({
        startDate: "2026-09-07",
        totalWeeks: 1,
        teachingWeeks: 1,
        isInUse: true,
      })
    )

    // First run: enable calendar sync -> syncs with namespace and persists hash
    const settings1 = scheduleSettingsStore.create(storage)
    const patches1 = schedulePatchesStore.create(storage)
    await vi.waitFor(() => {
      expect(settings1.hydrated.getSnapshot()).toBe(true)
      expect(patches1.hydrated.getSnapshot()).toBe(true)
    })

    const controller1 = new ClassReminderAndWidgetController({
      pluginId: "orahako.schedule",
      settingsStore: settings1,
      patchesStore: patches1,
      provider,
      session,
      native,
      widgets,
      scheduleSource,
      currentWeekSource,
      termCalendarSource,
      loadCapabilities: async () => [],
    })
    await controller1.handleChannelEnabled()
    expect(await controller1.setCalendarSyncEnabled(true)).toBe(true)

    const syncCalls1 = invokeCalls.filter((c) => c.id === "calendar.sync@1" && c.method === "sync")
    expect(syncCalls1).toHaveLength(1)
    expect(syncCalls1[0]?.payload?.namespace).toBe(CALENDAR_SYNC_NAMESPACE)
    expect(settings1.source.getSnapshot().calendarSyncLastHash).toBeTruthy()

    // Disposing the controller (plugin reload/unmount) must NOT wipe the system calendar
    await controller1.dispose()
    expect(
      invokeCalls.filter((c) => c.id === "calendar.sync@1" && c.method === "clear")
    ).toHaveLength(0)

    // Wait for persisted storage write to flush
    await vi.waitFor(async () => {
      const raw = await localBackend.getItem("schedule-settings")
      expect(raw).toContain("calendarSyncLastHash")
    })

    // Cold restart with a fresh controller reading the same persisted storage
    invokeCalls.length = 0
    const settings2 = scheduleSettingsStore.create(storage)
    const patches2 = schedulePatchesStore.create(storage)
    await vi.waitFor(() => {
      expect(settings2.hydrated.getSnapshot()).toBe(true)
      expect(patches2.hydrated.getSnapshot()).toBe(true)
    })

    const controller2 = new ClassReminderAndWidgetController({
      pluginId: "orahako.schedule",
      settingsStore: settings2,
      patchesStore: patches2,
      provider,
      session,
      native,
      widgets,
      scheduleSource,
      currentWeekSource,
      termCalendarSource,
      loadCapabilities: async () => [],
    })
    await controller2.handleChannelEnabled()
    await controller2.refreshCalendarSync()

    // Persisted hash matches -> ZERO native calendar sync calls on cold start!
    expect(
      invokeCalls.filter((c) => c.id === "calendar.sync@1" && c.method === "sync")
    ).toHaveLength(0)

    // Explicit disable clears only the schedule namespace
    expect(await controller2.setCalendarSyncEnabled(false)).toBe(true)
    const clearCalls = invokeCalls.filter((c) => c.id === "calendar.sync@1" && c.method === "clear")
    expect(clearCalls).toHaveLength(1)
    expect(clearCalls[0]?.payload).toEqual({ namespace: CALENDAR_SYNC_NAMESPACE })

    await controller2.dispose()
  })
})
