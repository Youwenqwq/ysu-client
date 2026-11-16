import { describe, expect, it, vi } from "vitest"
import type {
  ManagedProvider,
  PluginManagerService,
  PluginManifest,
  PluginProviderRuntimeService,
  ProviderRuntimeSnapshot,
} from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { providerSupportRuntimePlugin } from "./provider-support"

function manifest(
  id: string,
  kind: PluginManifest["kind"] = "feature",
  overrides: Partial<PluginManifest> = {}
): PluginManifest {
  return { id, name: id, version: "1.0.0", apiVersion: 2, kind, entry: "index.js", ...overrides }
}

function providerSnapshot(supportedPlugins?: readonly string[]): ProviderRuntimeSnapshot {
  return {
    status: "ready",
    schoolId: "test-school",
    provider: { supportedPlugins } as unknown as ManagedProvider,
    error: null,
    generation: 0,
  }
}

interface FakeProviderRuntime {
  snapshot: ProviderRuntimeSnapshot
  getSnapshot(): ProviderRuntimeSnapshot
  subscribe(): () => void
}

function setup(protectedIds: readonly string[] = []) {
  const runtime = new PluginRuntime()
  const userDisabledIds = new Set<string>()
  const provider: FakeProviderRuntime = {
    snapshot: providerSnapshot(),
    getSnapshot() {
      return this.snapshot
    },
    subscribe: () => () => {},
  }
  const manager = {
    enable: vi.fn(async (id: string) => runtime.start(id)),
    suspend: vi.fn((id: string) => runtime.stop(id)),
    disable: vi.fn((id: string) => runtime.stop(id)),
    isProtected: vi.fn((id: string) => protectedIds.includes(id)),
    isUserDisabled: vi.fn((id: string) => userDisabledIds.has(id)),
    getSnapshot: vi.fn(() => runtime.getSnapshot()),
    subscribe: runtime.subscribe,
  }
  runtime.context.set("provider", provider as unknown as PluginProviderRuntimeService)
  runtime.context.set("pluginManager", manager as unknown as PluginManagerService)
  runtime.register(
    providerSupportRuntimePlugin.manifest,
    providerSupportRuntimePlugin.definition,
    "builtin"
  )
  return { runtime, provider, manager, userDisabledIds }
}

function startFeature(runtime: PluginRuntime, definition: PluginManifest): void {
  runtime.register(definition, () => {}, "builtin")
  runtime.start(definition.id)
}

function publishProvider(
  runtime: PluginRuntime,
  provider: FakeProviderRuntime,
  supportedPlugins?: readonly string[]
): void {
  provider.snapshot = providerSnapshot(supportedPlugins)
  runtime.context.emit("provider/changed", provider.snapshot)
}

describe("provider support policy runtime", () => {
  it("stops unsupported features and restores only provider-stopped plugins", async () => {
    const { runtime, provider } = setup(["test.protected"])
    try {
      startFeature(runtime, manifest("test.supported"))
      startFeature(runtime, manifest("test.unsupported"))
      startFeature(runtime, manifest("test.protected"))
      startFeature(runtime, manifest("test.global", "feature", { providerIndependent: true }))
      startFeature(runtime, manifest("test.shell", "shell"))
      startFeature(runtime, manifest("test.provider", "provider"))
      startFeature(runtime, manifest("test.theme", "theme"))

      runtime.start(providerSupportRuntimePlugin.manifest.id)
      publishProvider(runtime, provider, ["test.supported"])

      await vi.waitFor(() => expect(runtime.get("test.unsupported")?.status).toBe("disabled"))
      expect(runtime.get("test.supported")?.status).toBe("active")
      expect(runtime.get("test.protected")?.status).toBe("active")
      expect(runtime.get("test.global")?.status).toBe("active")
      for (const id of ["test.shell", "test.provider", "test.theme"]) {
        expect(runtime.get(id)?.status).toBe("active")
      }

      publishProvider(runtime, provider, undefined)
      await vi.waitFor(() => expect(runtime.get("test.unsupported")?.status).toBe("active"))
    } finally {
      runtime.dispose()
    }
  })

  it("does not restore a plugin the user disabled while its provider was inactive", async () => {
    const { runtime, provider, manager, userDisabledIds } = setup()
    try {
      startFeature(runtime, manifest("test.user-disabled"))
      runtime.start(providerSupportRuntimePlugin.manifest.id)
      publishProvider(runtime, provider, [])
      await vi.waitFor(() =>
        expect(runtime.get("test.user-disabled")?.status).toBe("disabled")
      )

      userDisabledIds.add("test.user-disabled")
      const reconciles = manager.getSnapshot.mock.calls.length
      publishProvider(runtime, provider, undefined)
      await vi.waitFor(() =>
        expect(manager.getSnapshot.mock.calls.length).toBeGreaterThan(reconciles)
      )
      expect(runtime.get("test.user-disabled")?.status).toBe("disabled")
    } finally {
      runtime.dispose()
    }
  })

  it("leaves plugins untouched while the provider allows every plugin", async () => {
    const { runtime, provider, manager } = setup()
    try {
      startFeature(runtime, manifest("test.supported"))
      runtime.start(providerSupportRuntimePlugin.manifest.id)
      const reconciles = manager.getSnapshot.mock.calls.length
      publishProvider(runtime, provider, undefined)
      await vi.waitFor(() =>
        expect(manager.getSnapshot.mock.calls.length).toBeGreaterThan(reconciles)
      )
      expect(runtime.get("test.supported")?.status).toBe("active")
      expect(manager.suspend).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
    }
  })
})
