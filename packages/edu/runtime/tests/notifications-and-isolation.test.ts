import { describe, expect, it, vi } from "vitest"
import { defineSchoolProvider } from "@orahako/academic-sdk"
import {
  createMemoryPackageBackend,
  PluginHost,
  PluginPackageStore,
  PluginRuntime,
} from "@orahako/kernel"
import * as SdkNamespace from "@orahako/sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionSource,
  type NetworkActivitySnapshot,
  type PluginHttpService,
  type PluginKeyValueStorage,
  type PluginNavigationService,
  type PluginStorageService,
} from "@orahako/sdk"
import {
  AcademicNotificationRegistry,
  academicRuntimePlugins,
  notificationRegistryRuntimePlugin,
} from "../src"

function createMemoryStoragePlugin() {
  const wrap = (map: Map<string, string>): PluginKeyValueStorage => ({
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v)
    },
    removeItem: async (k) => {
      map.delete(k)
    },
  })

  return definePlugin({
    manifest: {
      id: "test.runtime.storage",
      name: "Memory storage",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      entry: "index.js",
      provides: ["storage"],
    },
    apply(ctx) {
      const storage: PluginStorageService = {
        local: wrap(new Map()),
        secure: wrap(new Map()),
      }
      ctx.set("storage", storage)
    },
  })
}

function createStubHttpPlugin() {
  return definePlugin({
    manifest: {
      id: "test.runtime.http",
      name: "Stub HTTP",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      entry: "index.js",
      provides: ["http"],
    },
    apply(ctx) {
      const activityState = createObservableSource<NetworkActivitySnapshot>({
        active: [],
        history: [],
        session: null,
        revision: 0,
      })
      const http: PluginHttpService = {
        send: async (req) => ({
          status: 200,
          url: req.url,
          headers: {},
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        }),
        activity: {
          state: activityState,
          getSnapshot: activityState.getSnapshot,
          subscribe: activityState.subscribe,
          beginRequest: () => () => {},
          registerLabeler: () => () => {},
          registerClassifier: () => () => {},
        },
      }
      ctx.set("http", http)
    },
  })
}

function createStubNavigationPlugin() {
  return definePlugin({
    manifest: {
      id: "test.runtime.navigation",
      name: "Stub navigation",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      entry: "index.js",
      provides: ["navigation"],
    },
    apply(ctx) {
      const state = createObservableSource(0)
      const nav: PluginNavigationService = {
        state,
        sources: () => ({ pages: [], navigation: [] }),
        resolve: () => undefined,
        primary: () => undefined,
        landing: () => "",
        available: () => true,
        forScope: () => [],
        registerFilter: () => {
          state.set((n) => n + 1)
          return () => state.set((n) => n + 1)
        },
      }
      ctx.set("navigation", nav)
    },
  })
}

describe("AcademicNotificationRegistry & notificationRegistryRuntimePlugin", () => {
  it("scopes registerChannel per plugin, orders by declared order and registration, and revokes on plugin stop", async () => {
    const runtime = new PluginRuntime()
    runtime.register(notificationRegistryRuntimePlugin, "builtin")
    await runtime.startAndWait(notificationRegistryRuntimePlugin.manifest.id)

    const schedulePlugin = definePlugin({
      manifest: {
        id: "orahako.schedule",
        name: "Schedule",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["notifications"],
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "schedule",
          order: 2,
          slice: "timetable",
          toPollingFlag: "schedule",
        })
      },
    })

    const gradesPlugin = definePlugin({
      manifest: {
        id: "orahako.grades",
        name: "Grades",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["notifications"],
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "grades",
          order: 1,
          slice: "grades",
          toPollingFlag: "grades",
        })
      },
    })

    const libraryOnEnable = vi.fn()
    const customPlugin = definePlugin({
      manifest: {
        id: "ext.library",
        name: "Library",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["notifications"],
      apply(ctx) {
        ctx.notifications.registerChannel({
          id: "library-due",
          order: 3,
          toPollingFlag: (enabled) => ({ libraryDue: enabled }),
          onEnable: libraryOnEnable,
        })
      },
    })

    // Start in reverse order (custom -> schedule -> grades); explicit order wins.
    runtime.register(customPlugin, "external")
    runtime.register(schedulePlugin, "builtin")
    runtime.register(gradesPlugin, "builtin")

    await runtime.startAndWait(customPlugin.manifest.id)
    await runtime.startAndWait(schedulePlugin.manifest.id)
    await runtime.startAndWait(gradesPlugin.manifest.id)

    const registry = runtime.context.get("notifications")!
    expect(registry.getSnapshot().map((c) => ({ id: c.id, pluginId: c.pluginId }))).toEqual([
      { id: "grades", pluginId: "orahako.grades" },
      { id: "schedule", pluginId: "orahako.schedule" },
      { id: "library-due", pluginId: "ext.library" },
    ])
    expect(
      registry.getSnapshot().find((channel) => channel.id === "library-due")?.onEnable
    ).toBe(libraryOnEnable)

    // Stopping gradesPlugin revokes ONLY "grades"
    runtime.stop(gradesPlugin.manifest.id)
    expect(registry.getSnapshot().map((c) => c.id)).toEqual(["schedule", "library-due"])

    // Empty channel id throws loud
    const standalone = new AcademicNotificationRegistry()
    expect(() => standalone.registerChannel({ id: "  " })).toThrow("must not be empty")

    runtime.dispose()
  })

  it("orders unconfigured channels by stable registration and lets explicit order override it", () => {
    const registry = new AcademicNotificationRegistry()
    registry.registerChannel({ id: "schedule" })
    registry.registerChannel({ id: "exams" })
    registry.registerChannel({ id: "grades" })
    expect(registry.getSnapshot().map((channel) => channel.id)).toEqual([
      "schedule",
      "exams",
      "grades",
    ])

    registry.registerChannel({ id: "exams", order: 0 })
    expect(registry.getSnapshot().map((channel) => channel.id)).toEqual([
      "exams",
      "schedule",
      "grades",
    ])
  })
})

describe("academicRuntimePlugins bundle & non-academic composition isolation", () => {
  it("boots a pure non-academic composition with zero academic services present", async () => {
    const storagePlugin = createMemoryStoragePlugin()
    const httpPlugin = createStubHttpPlugin()
    const navPlugin = createStubNavigationPlugin()
    let ranCommunityFeature = false

    const communityFeature = definePlugin({
      manifest: {
        id: "community.feed",
        name: "Community Feed",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["storage", "http", "navigation"],
      apply() {
        ranCommunityFeature = true
      },
    })

    const source: CompositionSource = {
      appVersion: "0.17.0",
      appBuild: "community-1",
      composition: {
        id: "community.app",
        version: 1,
        defaults: {},
        plugins: [
          { id: storagePlugin.manifest.id, protected: true },
          { id: httpPlugin.manifest.id, protected: true },
          { id: navPlugin.manifest.id, protected: true },
          { id: communityFeature.manifest.id },
        ],
      },
      plugins: [storagePlugin, httpPlugin, navPlugin, communityFeature],
    }

    const host = new PluginHost(source, {
      platformModules: { "@orahako/sdk": SdkNamespace },
      packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
    })

    await host.bootstrap()
    expect(host.loadErrors.size).toBe(0)
    expect(ranCommunityFeature).toBe(true)

    // Verify complete absence of every academic runtime service in non-academic compositions
    for (const serviceName of [
      "providers",
      "session",
      "provider",
      "query",
      "notifications",
    ] as const) {
      expect(host.runtime.context.get(serviceName)).toBeUndefined()
    }

    host.dispose()
  })

  it("boots all 6 academicRuntimePlugins together cleanly on PluginHost and serves end-to-end provider queries", async () => {
    expect(academicRuntimePlugins).toHaveLength(6)

    const storagePlugin = createMemoryStoragePlugin()
    const httpPlugin = createStubHttpPlugin()
    const navPlugin = createStubNavigationPlugin()

    const ysuProviderPlugin = definePlugin({
      manifest: {
        id: "orahako.ysu",
        name: "YSU Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
      },
      inject: ["providers"],
      apply(ctx) {
        ctx.providers.registerProvider("ysu", () =>
          defineSchoolProvider({
            id: "ysu",
            name: "燕山大学",
            timeZone: "Asia/Shanghai",
            slices: {
              studentProfile: {
                getStudentInfo: async () => ({
                  name: "张三",
                  studentId: "202201",
                }),
              },
            },
            initialize: async () => {},
            reset: async () => {},
            logout: async () => {},
            dispose: async () => {},
            relogin: async () => true,
          })
        )
      },
    })

    const source: CompositionSource = {
      appVersion: "0.17.0",
      appBuild: "academic-1",
      composition: {
        id: "academic.app",
        version: 1,
        defaults: { schoolId: "ysu" },
        plugins: [
          { id: storagePlugin.manifest.id, protected: true },
          { id: httpPlugin.manifest.id, protected: true },
          { id: navPlugin.manifest.id, protected: true },
          ...academicRuntimePlugins.map((plugin) => ({
            id: plugin.manifest.id,
            protected: true,
            ...(plugin.manifest.id === "orahako.runtime.session" ||
            plugin.manifest.id === "orahako.runtime.provider"
              ? { config: { defaultSchoolId: "ysu" } }
              : {}),
          })),
          { id: ysuProviderPlugin.manifest.id },
        ],
      },
      plugins: [storagePlugin, httpPlugin, navPlugin, ...academicRuntimePlugins, ysuProviderPlugin],
    }

    const host = new PluginHost(source, {
      platformModules: { "@orahako/sdk": SdkNamespace },
      packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
    })

    await host.bootstrap()
    expect(Array.from(host.loadErrors.entries())).toEqual([])

    for (const plugin of academicRuntimePlugins) {
      expect(host.runtime.get(plugin.manifest.id)?.status).toBe("active")
    }

    const providerService = host.runtime.context.get("provider")!
    const sessionService = host.runtime.context.get("session")!
    const queryService = host.runtime.context.get("query")!

    sessionService.setCredential({ schoolId: "ysu", credential: "tgc", username: "202201" })
    await providerService.initialize()
    expect(providerService.getSnapshot().status).toBe("ready")

    const profileSource = queryService.source({
      feature: "student-info",
      slice: "studentProfile",
      fetcher: (p) => p.slices.studentProfile!.getStudentInfo(),
    })
    const result = await profileSource.getSnapshot().refresh()
    expect(result).toEqual({ name: "张三", studentId: "202201" })
    expect(profileSource.getSnapshot().status).toBe("success")

    host.dispose()
  })
})
