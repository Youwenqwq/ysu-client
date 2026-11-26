import { describe, expect, it, vi } from "vitest"
import {
  defineSchoolProvider,
  type AcademicSliceMap,
  type ProviderRuntimeService,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import {
  createObservableSource,
  PLUGIN_API_VERSION,
  type NavigationFilter,
  type NavigationFilterContext,
  type PluginManagerService,
  type PluginManifest,
  type PluginNavigationService,
} from "@orahako/sdk"
import { providerSupportRuntimePlugin } from "../src"

function makeManifest(
  id: string,
  kind: PluginManifest["kind"] = "feature",
  overrides: Partial<PluginManifest> = {}
): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind,
    entry: "index.js",
    ...overrides,
  }
}

function makeProvider(
  id: string,
  supportedPlugins?: readonly string[],
  slices: Partial<AcademicSliceMap> = {}
): SchoolProvider {
  return defineSchoolProvider({
    id,
    name: id,
    timeZone: "Asia/Shanghai",
    ...(supportedPlugins !== undefined ? { supportedPlugins } : {}),
    slices,
    initialize: async () => {},
    reset: async () => {},
    logout: async () => {},
    dispose: async () => {},
    relogin: async () => true,
  })
}

function setupHarness(protectedIds: readonly string[] = []) {
  const runtime = new PluginRuntime()
  const userDisabledIds = new Set<string>()
  let generation = 0

  const providerState = createObservableSource<ProviderRuntimeSnapshot>({
    status: "unavailable",
    schoolId: null,
    provider: null,
    error: null,
    generation: 0,
  })

  const providerService: ProviderRuntimeService = {
    state: providerState,
    getSnapshot: providerState.getSnapshot,
    subscribe: providerState.subscribe,
    getActive: () => {
      const current = providerState.getSnapshot().provider
      if (!current) throw new Error("unavailable")
      return current
    },
    selectSchool: () => {
      throw new Error("unused")
    },
    initialize: async () => {
      throw new Error("unused")
    },
    reset: async () => {},
    logout: async () => {},
    relogin: async () => false,
  }

  const pluginManager: PluginManagerService = {
    state: runtime.state,
    enable: vi.fn(async (id: string) => {
      await runtime.startAndWait(id)
    }),
    suspend: vi.fn((id: string) => runtime.stop(id)),
    disable: vi.fn((id: string) => {
      userDisabledIds.add(id)
      runtime.stop(id)
    }),
    isProtected: vi.fn((id: string) => protectedIds.includes(id)),
    isUserDisabled: vi.fn((id: string) => userDisabledIds.has(id)),
    getSnapshot: vi.fn(() => runtime.getSnapshot()),
    subscribe: runtime.subscribe,
  }

  const activeFilters = new Set<NavigationFilter>()
  const navRevision = createObservableSource<number>(0)
  const bumpNav = () => navRevision.set((n) => n + 1)

  const navigation: PluginNavigationService = {
    state: navRevision,
    sources: () => ({ pages: [], navigation: [] }),
    resolve: () => undefined,
    primary: () => undefined,
    landing: () => "",
    available: () => true,
    forScope: () => [],
    registerFilter: (filter) => {
      activeFilters.add(filter)
      bumpNav()
      return () => {
        if (activeFilters.delete(filter)) {
          bumpNav()
        }
      }
    },
  }

  const evaluateNav = (entry: NavigationFilterContext): boolean => {
    for (const filter of activeFilters) {
      if (!filter(entry)) return false
    }
    return true
  }

  const publishProvider = (provider: SchoolProvider | null) => {
    generation += 1
    const snap: ProviderRuntimeSnapshot = {
      status: provider ? "ready" : "unavailable",
      schoolId: provider?.id ?? null,
      provider,
      error: null,
      generation,
    }
    providerState.set(snap)
    runtime.context.emit("provider/changed", snap)
  }

  runtime.context.set("provider", providerService)
  runtime.context.set("pluginManager", pluginManager)
  runtime.context.set("navigation", navigation)
  runtime.register(providerSupportRuntimePlugin, "builtin")

  return {
    runtime,
    pluginManager,
    navigation,
    userDisabledIds,
    activeFilters,
    evaluateNav,
    publishProvider,
  }
}

function registerAndStart(runtime: PluginRuntime, manifest: PluginManifest): void {
  runtime.register(manifest, () => {}, "builtin")
  runtime.start(manifest.id)
}

describe("providerSupportRuntimePlugin", () => {
  it("suspends unsupported features while sparing protected, providerIndependent, and non-feature plugins, then restores", async () => {
    const { runtime, publishProvider } = setupHarness(["feature.protected"])
    try {
      registerAndStart(runtime, makeManifest("feature.schedule"))
      registerAndStart(runtime, makeManifest("feature.ecard"))
      registerAndStart(runtime, makeManifest("feature.protected"))
      registerAndStart(
        runtime,
        makeManifest("feature.toybox", "feature", { providerIndependent: true })
      )
      registerAndStart(runtime, makeManifest("app.shell", "shell"))
      registerAndStart(runtime, makeManifest("app.theme", "theme"))
      registerAndStart(runtime, makeManifest("school.ysu", "provider"))

      await runtime.startAndWait(providerSupportRuntimePlugin.manifest.id)

      publishProvider(makeProvider("zmu", ["feature.schedule"]))

      await vi.waitFor(() => {
        expect(runtime.get("feature.ecard")?.status).toBe("disabled")
      })
      expect(runtime.get("feature.schedule")?.status).toBe("active")
      expect(runtime.get("feature.protected")?.status).toBe("active")
      expect(runtime.get("feature.toybox")?.status).toBe("active")
      expect(runtime.get("app.shell")?.status).toBe("active")
      expect(runtime.get("app.theme")?.status).toBe("active")
      expect(runtime.get("school.ysu")?.status).toBe("active")

      // Switching to unrestricted provider restores feature.ecard
      publishProvider(makeProvider("ysu", undefined))
      await vi.waitFor(() => {
        expect(runtime.get("feature.ecard")?.status).toBe("active")
      })
    } finally {
      runtime.dispose()
    }
  })

  it("never restores user-disabled plugins or plugins that were already disabled before provider restriction", async () => {
    const { runtime, pluginManager, userDisabledIds, publishProvider } = setupHarness()
    try {
      registerAndStart(runtime, makeManifest("feature.grades"))
      runtime.register(makeManifest("feature.pre-disabled"), () => {}, "builtin")
      runtime.stop("feature.pre-disabled")
      userDisabledIds.add("feature.pre-disabled")

      await runtime.startAndWait(providerSupportRuntimePlugin.manifest.id)

      // Restrict all features -> feature.grades gets suspended by policy
      publishProvider(makeProvider("restricted", []))
      await vi.waitFor(() => {
        expect(runtime.get("feature.grades")?.status).toBe("disabled")
      })

      // User explicitly disables feature.grades while restricted
      userDisabledIds.add("feature.grades")

      const callsBefore = vi.mocked(pluginManager.getSnapshot).mock.calls.length
      publishProvider(makeProvider("full", undefined))
      await vi.waitFor(() => {
        expect(vi.mocked(pluginManager.getSnapshot).mock.calls.length).toBeGreaterThan(callsBefore)
      })

      expect(runtime.get("feature.grades")?.status).toBe("disabled")
      expect(runtime.get("feature.pre-disabled")?.status).toBe("disabled")
      expect(pluginManager.enable).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
    }
  })

  it("registers navigation filter checking supportsPlugin, requiresProvider, and hasSlice, bumping navigation.state on provider changes", async () => {
    const { runtime, navigation, activeFilters, evaluateNav, publishProvider } = setupHarness()
    try {
      await runtime.startAndWait(providerSupportRuntimePlugin.manifest.id)
      expect(activeFilters.size).toBe(1)

      // While provider is null (unavailable):
      // - entry with capability & default requiresProvider (true) is hidden
      // - entry with requiresProvider: false is visible
      // - entry without capability is visible
      expect(evaluateNav({ pluginId: "feature.schedule", capability: "timetable" })).toBe(false)
      expect(
        evaluateNav({
          pluginId: "feature.settings",
          capability: "timetable",
          requiresProvider: false,
        })
      ).toBe(true)
      expect(evaluateNav({ pluginId: "feature.about" })).toBe(true)

      const navStateBefore = navigation.state.getSnapshot()

      // Activate provider with timetable slice and allowlist ["feature.schedule", "feature.exams", "feature.settings"]
      publishProvider(
        makeProvider("zmu", ["feature.schedule", "feature.exams", "feature.settings"], {
          timetable: {
            getSchedule: async () => [],
          },
        })
      )

      // navigation.state must have incremented so shells react to provider changes!
      expect(navigation.state.getSnapshot()).toBeGreaterThan(navStateBefore)

      expect(evaluateNav({ pluginId: "feature.schedule", capability: "timetable" })).toBe(true)
      // Allowed plugin, but provider lacks "exams" slice -> filtered out!
      expect(evaluateNav({ pluginId: "feature.exams", capability: "exams" })).toBe(false)
      // Disallowed plugin -> filtered out even when requiresProvider: false!
      expect(evaluateNav({ pluginId: "feature.ecard", requiresProvider: false })).toBe(false)
      // Allowed plugin + requiresProvider: false -> visible even without "exams" slice!
      expect(
        evaluateNav({
          pluginId: "feature.settings",
          capability: "exams",
          requiresProvider: false,
        })
      ).toBe(true)

      // Stopping provider-support revokes its navigation filter cleanly
      runtime.stop(providerSupportRuntimePlugin.manifest.id)
      expect(activeFilters.size).toBe(0)
    } finally {
      runtime.dispose()
    }
  })
})
