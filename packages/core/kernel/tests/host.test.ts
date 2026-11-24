import { zipSync } from "fflate"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as SdkNamespace from "@orahako/sdk"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionSource,
  type MarketplaceIndex,
  type PluginManifest,
  type PluginNativeService,
  type PluginPackageRuntime,
} from "@orahako/sdk"
import {
  beginPluginBoot,
  createMemoryPackageBackend,
  createPluginHostPreferences,
  finishPluginBoot,
  nextPluginBootState,
  PluginHost,
  PluginPackageStore,
} from "@orahako/kernel"

function makeManifest(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    entry: "index.js",
    ...extra,
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("PluginHost Cordis-native boot, bundles, and recovery", () => {
  it("boots out-of-order composition plugins (consumer listed before provider) without polling", async () => {
    const order: string[] = []

    const consumerPlugin = definePlugin({
      manifest: makeManifest("app.consumer"),
      inject: ["analytics"],
      apply(ctx) {
        order.push(`consumer:${ctx.analytics.endpoint}`)
      },
    })

    const providerPlugin = definePlugin({
      manifest: makeManifest("app.analytics", { kind: "runtime", provides: ["analytics"] }),
      apply: async (ctx) => {
        await Promise.resolve()
        order.push("provider:ready")
        ctx.set("analytics", {
          endpoint: "https://telemetry.example",
          track: async () => ({ tracked: true, reason: "sent", date: null }),
        })
      },
    })

    const source: CompositionSource = {
      appVersion: "0.17.0",
      appBuild: "build-1",
      composition: {
        id: "test.app",
        version: 1,
        defaults: {},
        plugins: [
          // Intentionally list consumer BEFORE provider!
          { id: consumerPlugin.manifest.id },
          { id: providerPlugin.manifest.id, protected: true },
        ],
      },
      plugins: [consumerPlugin, providerPlugin],
    }

    const host = new PluginHost(source, {
      platformModules: { "@orahako/sdk": SdkNamespace },
      packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
    })

    await host.bootstrap()
    expect(host.loadErrors.size).toBe(0)
    expect(host.runtime.get("app.analytics")?.status).toBe("active")
    expect(host.runtime.get("app.consumer")?.status).toBe("active")
    expect(order).toEqual(["provider:ready", "consumer:https://telemetry.example"])

    expect(() => host.disable("app.analytics")).toThrow("protected by the active composition")
    host.dispose()
  })

  it("preflights and installs API v1 marketplace bundles in dependency order", async () => {
    const store = new PluginPackageStore({ backend: createMemoryPackageBackend() })
    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "build-1",
        composition: {
          id: "test.market",
          version: 1,
          defaults: {},
          market: { indexUrl: "https://market.example.com/plugins.json" },
          plugins: [],
        },
        plugins: [],
      },
      {
        platformModules: { "@orahako/sdk": SdkNamespace },
        packages: store,
      }
    )

    const index: MarketplaceIndex = {
      schemaVersion: 1,
      updatedAt: "2026-11-18T00:00:00Z",
      plugins: ["ext.consumer", "ext.base", "ext.service"].map((id) => ({
        id,
        name: id,
        summary: id,
        author: "Test",
        categories: ["feature"],
        versions: [
          {
            version: "9.0.0",
            apiVersion: 2, // Unsupported release ignored by the v1 selector.
            platforms: ["web", "android"],
            zipUrl: `/v2/${id}.zip`,
            sha256: "f".repeat(64),
            size: 50,
            publishedAt: "2026-11-01T00:00:00Z",
          },
          {
            version: "1.0.0",
            apiVersion: 1,
            platforms: ["web", "android"],
            zipUrl: `/v1/${id}.zip`,
            sha256: "a".repeat(64),
            size: 100,
            publishedAt: "2026-11-18T00:00:00Z",
            requires: id === "ext.consumer" ? { "ext.base": "^1.0.0" } : undefined,
            inject: id === "ext.consumer" ? ["analytics"] : undefined,
            provides: id === "ext.service" ? ["analytics"] : undefined,
          },
        ],
      })),
    }

    const consumer = index.plugins.find((plugin) => plugin.id === "ext.consumer")!
    index.plugins.push({
      ...consumer,
      id: "ext.incompatible",
      versions: consumer.versions.map((release) => ({
        ...release,
        requires: { "ext.base": "^2.0.0" },
      })),
    })

    const installedOrder: string[] = []
    vi.spyOn(host, "installFromUrl").mockImplementation(async (url, _sha, expected) => {
      expect(url).toMatch(/^https:\/\/custom\.market\.example\/v1\//)
      installedOrder.push(expected.id)
      const manifest = makeManifest(expected.id, {
        version: expected.version,
        provides: expected.id === "ext.service" ? ["analytics"] : undefined,
      })
      host.runtime.register(
        manifest,
        (ctx) => {
          if (expected.id === "ext.service") {
            ctx.set("analytics", {
              endpoint: null,
              track: async () => ({ tracked: false, reason: "disabled", date: null }),
            })
          }
        },
        "external"
      )
      await host.runtime.startAndWait(expected.id)
      return manifest
    })

    await expect(
      host.applyPluginBundle(
        ["ext.incompatible"],
        index,
        "https://custom.market.example/plugins.json"
      )
    ).rejects.toThrow("Plugin dependency ext.base@1.0.0 does not satisfy ^2.0.0")
    expect(installedOrder).toEqual([])

    await host.applyPluginBundle(
      ["ext.consumer"],
      index,
      "https://custom.market.example/plugins.json"
    )
    expect(installedOrder).toEqual(["ext.base", "ext.service", "ext.consumer"])
    host.dispose()
  })

  it("verifies SHA-256 hashes on install and enters safe mode after repeated boot crashes", async () => {
    const encoder = new TextEncoder()
    const zipBytes = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.demo",
          name: "Demo",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })
    const validHash = await sha256Hex(zipBytes)

    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b1",
        composition: { id: "test.sha", version: 1, defaults: {}, plugins: [] },
        plugins: [],
      },
      {
        platformModules: {},
        packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
      }
    )

    await expect(host.install(zipBytes, "0".repeat(64))).rejects.toThrow("SHA-256 mismatch")
    expect(validHash).toHaveLength(64)
    host.dispose()

    // Crash recovery state transitions
    const first = nextPluginBootState(undefined, "build-x")
    expect(first).toEqual({ phase: "starting", build: "build-x", crashStreak: 0, safeMode: false })
    const second = nextPluginBootState(first, "build-x")
    expect(second.crashStreak).toBe(1)
    expect(second.safeMode).toBe(false)
    const third = nextPluginBootState(second, "build-x")
    expect(third.crashStreak).toBe(2)
    expect(third.safeMode).toBe(true)

    // New build resets crash streak
    expect(nextPluginBootState(third, "build-y").safeMode).toBe(false)
    expect(typeof beginPluginBoot).toBe("function")
    expect(typeof finishPluginBoot).toBe("function")
  })

  it("injects and cleans up external plugin <style> elements and rolls back failed updates", async () => {
    const appended: Array<{
      dataset: Record<string, string>
      textContent: string
      removed: boolean
      remove(): void
    }> = []
    vi.stubGlobal("document", {
      head: {
        append(el: (typeof appended)[number]) {
          appended.push(el)
        },
      },
      createElement(_tag: string) {
        const el = {
          dataset: {} as Record<string, string>,
          textContent: "",
          removed: false,
          remove() {
            el.removed = true
          },
        }
        return el
      },
    })

    let blobCounter = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const code = blob instanceof Blob ? "export default { apply() {} }" : ""
      return `data:text/javascript;base64,${btoa(code)}#${++blobCounter}`
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    const encoder = new TextEncoder()
    const goodZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.styled",
          name: "Styled",
          version: "1.0.0",
          apiVersion: 1,
          kind: "theme",
          entry: "index.js",
          styles: ["theme.css"],
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
      "theme.css": encoder.encode(":root { --accent: lime; }"),
    })
    const goodHash = await sha256Hex(goodZip)

    const store = new PluginPackageStore({ backend: createMemoryPackageBackend() })
    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b1",
        composition: { id: "test.styles", version: 1, defaults: {}, plugins: [] },
        plugins: [],
      },
      { platformModules: {}, packages: store }
    )

    const manifest = await host.install(goodZip, goodHash)
    expect(manifest.version).toBe("1.0.0")
    expect(appended).toHaveLength(1)
    expect(appended[0]?.textContent).toBe(":root { --accent: lime; }")
    expect(appended[0]?.removed).toBe(false)

    host.suspend("ext.styled")
    expect(appended[0]?.removed).toBe(true)

    await host.enable("ext.styled")
    expect(appended).toHaveLength(2)
    expect(appended[1]?.removed).toBe(false)

    // Failing update rolls back to 1.0.0
    vi.spyOn(URL, "createObjectURL").mockImplementationOnce(() => {
      return `data:text/javascript;base64,${btoa(
        `export default { apply() { throw new Error("broken v2.0.0") } }`
      )}`
    })
    const badZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.styled",
          name: "Styled",
          version: "2.0.0",
          apiVersion: 1,
          kind: "theme",
          entry: "index.js",
          styles: ["theme.css"],
        })
      ),
      "index.js": encoder.encode(`export default { apply() { throw new Error("broken") } }\n`),
      "theme.css": encoder.encode(":root { --accent: red; }"),
    })
    await expect(host.install(badZip)).rejects.toThrow("broken v2.0.0")
    expect((await store.read("ext.styled"))?.manifest.version).toBe("1.0.0")
    expect(host.runtime.get("ext.styled")?.status).toBe("active")

    await host.uninstall("ext.styled")
    expect(await store.read("ext.styled")).toBeUndefined()
    host.dispose()
  })

  it("exposes sideload, uninstall, listInstalled, metadata, loadErrors, shell selection, and safeMode on packageRuntime", async () => {
    let blobCounter = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const code = blob instanceof Blob ? "export default { apply() {} }" : ""
      return `data:text/javascript;base64,${btoa(code)}#pkg-${++blobCounter}`
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    const encoder = new TextEncoder()
    const sideloadZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.sideloaded",
          name: "Sideloaded",
          version: "1.2.3",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })

    let packageRuntime!: PluginPackageRuntime
    const probePlugin = definePlugin({
      manifest: makeManifest("app.probe"),
      inject: ["packageRuntime"],
      apply(ctx) {
        packageRuntime = ctx.packageRuntime
      },
    })

    const store = new PluginPackageStore({ backend: createMemoryPackageBackend() })
    const host = new PluginHost(
      {
        appVersion: "0.17.5",
        appBuild: "b-runtime",
        composition: {
          id: "test.pkg-runtime",
          version: 1,
          defaults: { shell: "orahako.shell:default" },
          market: { indexUrl: "https://market.example.com/index.json" },
          plugins: [{ id: probePlugin.manifest.id }],
        },
        plugins: [probePlugin],
      },
      {
        platformModules: { "@orahako/sdk": SdkNamespace },
        packages: store,
      }
    )

    await host.bootstrap()
    expect(packageRuntime.appVersion?.()).toBe("0.17.5")
    expect(packageRuntime.marketUrl?.()).toBe("https://market.example.com/index.json")
    expect(packageRuntime.safeMode?.()).toBe(false)
    expect(packageRuntime.getActiveShell?.()).toBeUndefined()

    packageRuntime.setActiveShell?.("ext.sideloaded:alt")
    expect(packageRuntime.getActiveShell?.()).toBe("ext.sideloaded:alt")

    const manifest = await packageRuntime.installPackage!(sideloadZip)
    expect(manifest).toMatchObject({ id: "ext.sideloaded", version: "1.2.3" })
    const installed = await packageRuntime.listInstalled!()
    expect(installed).toHaveLength(1)
    expect(installed[0]?.manifest.id).toBe("ext.sideloaded")

    // Failing sideload populates loadErrors()
    vi.spyOn(URL, "createObjectURL").mockImplementationOnce(() => {
      return `data:text/javascript;base64,${btoa(
        `export default { apply() { throw new Error("sideload crash") } }`
      )}`
    })
    const brokenZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.broken",
          name: "Broken",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode(`export default { apply() { throw new Error("crash") } }\n`),
    })
    await expect(packageRuntime.installPackage!(brokenZip)).rejects.toThrow("sideload crash")
    expect(packageRuntime.loadErrors?.().get("ext.broken")).toContain("sideload crash")

    // Uninstalling ext.sideloaded resets activeShell belonging to it
    await packageRuntime.uninstall!("ext.sideloaded")
    expect(await packageRuntime.listInstalled!()).toHaveLength(0)
    expect(packageRuntime.getActiveShell?.()).toBeUndefined()

    host.dispose()
  })

  it("rejects shadowing installs before writing storage and keeps the builtin registration", async () => {
    const encoder = new TextEncoder()
    const store = new PluginPackageStore({ backend: createMemoryPackageBackend() })
    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b-shadow",
        composition: { id: "test.shadow", version: 1, defaults: {}, plugins: [] },
        plugins: [],
      },
      { platformModules: {}, packages: store }
    )

    const shadowZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.shadow",
          name: "Shadow",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })

    host.runtime.register(makeManifest("ext.shadow"), () => {}, "builtin")
    host.runtime.start("ext.shadow")

    await expect(host.install(shadowZip)).rejects.toThrow(
      "External plugin cannot shadow a composition module: ext.shadow"
    )
    expect(host.runtime.get("ext.shadow")?.source).toBe("builtin")
    expect(await store.read("ext.shadow")).toBeUndefined()
    expect(await store.list()).toHaveLength(0)
    host.dispose()
  })

  it("rejects installs whose minAppVersion is newer than the running app", async () => {
    const encoder = new TextEncoder()
    const store = new PluginPackageStore({ backend: createMemoryPackageBackend() })
    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b-min-app",
        composition: { id: "test.min-app", version: 1, defaults: {}, plugins: [] },
        plugins: [],
      },
      { platformModules: {}, packages: store }
    )

    const futureZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.future",
          name: "Future",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
          minAppVersion: "9.0.0",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })

    await expect(host.install(futureZip)).rejects.toThrow("requires app 9.0.0 or newer")
    expect(await store.read("ext.future")).toBeUndefined()
    host.dispose()
  })

  it("records stale installed manifests per plugin without blocking valid packages", async () => {
    let blobCounter = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const code = blob instanceof Blob ? "export default { apply() {} }" : ""
      return `data:text/javascript;base64,${btoa(code)}#stale-${++blobCounter}`
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    const encoder = new TextEncoder()
    const backend = createMemoryPackageBackend()
    const store = new PluginPackageStore({ backend })
    const validZip = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "ext.valid",
          name: "ext.valid",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })
    await store.install(validZip)

    const files = [{ path: "index.js", data: encoder.encode("export default { apply() {} }\n") }]
    await backend.put({
      manifest: { ...makeManifest("ext.stale"), apiVersion: 2 },
      files,
      installedAt: 1,
    })
    await backend.put({
      manifest: makeManifest("ext.newer", { minAppVersion: "9.0.0" }),
      files,
      installedAt: 2,
    })

    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b-stale",
        composition: { id: "test.stale", version: 1, defaults: {}, plugins: [] },
        plugins: [],
      },
      {
        platformModules: { "@orahako/sdk": SdkNamespace },
        packages: store,
      }
    )

    await host.bootstrap()
    expect(host.loadErrors.get("ext.stale")).toContain("apiVersion must be 1")
    expect(host.loadErrors.get("ext.newer")).toContain("requires app 9.0.0")
    expect(host.loadErrors.get("ext.valid")).toBeUndefined()
    expect(host.runtime.get("ext.valid")?.status).toBe("active")
    expect(host.runtime.get("ext.stale")).toBeUndefined()
    host.dispose()
  })

  it("bounds async composition startup and ignores late apply side effects", async () => {
    const { promise: gate, resolve: release } = Promise.withResolvers<void>()
    const slowPlugin = definePlugin({
      manifest: makeManifest("app.slow", { kind: "runtime", provides: ["analytics"] }),
      apply: async (ctx) => {
        await gate
        ctx.set("analytics", {
          endpoint: null,
          track: async () => ({ tracked: false, reason: "disabled", date: null }),
        })
      },
    })

    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b-slow",
        composition: {
          id: "test.slow",
          version: 1,
          defaults: {},
          plugins: [{ id: slowPlugin.manifest.id }],
        },
        plugins: [slowPlugin],
      },
      {
        platformModules: { "@orahako/sdk": SdkNamespace },
        packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
        pluginStartTimeoutMs: 10,
      }
    )

    await host.bootstrap()
    expect(host.loadErrors.get("app.slow")).toContain("startup timed out")
    expect(host.runtime.get("app.slow")?.status).toBe("failed")

    release()
    await host.runtime.flush()
    expect(host.runtime.context.get("analytics")).toBeUndefined()
    expect(host.runtime.get("app.slow")?.status).toBe("failed")
    host.dispose()
  })

  it("records native capability failures in safe mode but still fails a normal boot", async () => {
    const storage = new Map<string, string>([
      [
        "orahako-plugin-recovery",
        JSON.stringify({
          phase: "starting",
          build: "safe-build",
          crashStreak: 2,
          safeMode: false,
        }),
      ],
    ])
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
    })

    const native = {
      isNative: true,
      capabilities: { list: () => [] },
    } as unknown as PluginNativeService
    const source: CompositionSource = {
      appVersion: "0.17.0",
      appBuild: "safe-build",
      composition: {
        id: "test.safe-mode",
        version: 1,
        defaults: {},
        nativeCapabilities: ["widgets.schedule@1"],
        plugins: [],
      },
      plugins: [],
    }

    const safeHost = new PluginHost(source, { platformModules: {} })
    safeHost.runtime.context.set("native", native)
    await safeHost.bootstrap()
    expect(safeHost.recovery?.safeMode).toBe(true)
    expect(safeHost.bootstrapError).toContain("not implemented")
    expect(safeHost.runtime.context.get("pluginManager")).toBeDefined()
    safeHost.dispose()

    vi.unstubAllGlobals()
    const normalHost = new PluginHost(source, { platformModules: {} })
    normalHost.runtime.context.set("native", native)
    await expect(normalHost.bootstrap()).rejects.toThrow(
      "Composition native capabilities are not implemented"
    )
    normalHost.dispose()
  })

  it("publishes shared preference snapshots only for shell, theme, and startup writes", () => {
    const storage = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
    })

    const preferences = createPluginHostPreferences("test-preferences")
    expect(preferences.state.getSnapshot()).toEqual({})
    const listener = vi.fn()
    const unsubscribe = preferences.state.subscribe(listener)

    preferences.setActiveShell("app.shell:default")
    expect(preferences.state.getSnapshot()).toEqual({ activeShell: "app.shell:default" })
    preferences.setActiveTheme("app.theme:dark")
    expect(preferences.state.getSnapshot()).toEqual({
      activeShell: "app.shell:default",
      activeTheme: "app.theme:dark",
    })
    preferences.setStartupPage("overview")
    expect(preferences.state.getSnapshot()).toEqual({
      activeShell: "app.shell:default",
      activeTheme: "app.theme:dark",
      startupPage: "overview",
    })
    expect(listener).toHaveBeenCalledTimes(3)

    preferences.setPluginDisabled("ext.demo", true)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(preferences.state.getSnapshot()).toEqual({
      activeShell: "app.shell:default",
      activeTheme: "app.theme:dark",
      startupPage: "overview",
    })
    expect(preferences.getActiveTheme()).toBe("app.theme:dark")
    expect(preferences.getStartupPage()).toBe("overview")
    expect(JSON.parse(storage.get("test-preferences")!)).toEqual({
      disabledPluginIds: ["ext.demo"],
      activeShell: "app.shell:default",
      activeTheme: "app.theme:dark",
      startupPage: "overview",
    })
    unsubscribe()
  })

  it("exposes the preference source through packageRuntime", () => {
    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b-preferences",
        composition: {
          id: "test.preferences",
          version: 1,
          defaults: { landing: "overview", shell: "app.shell:default" },
          plugins: [],
        },
        plugins: [],
      },
      { platformModules: {} }
    )
    const packageRuntime = host.runtime.context.get("packageRuntime")!
    expect(packageRuntime.preferenceState).toBe(host.preferences.state)
    expect(packageRuntime.defaultLanding?.()).toBe("overview")
    expect(packageRuntime.defaultShell?.()).toBe("app.shell:default")

    packageRuntime.setActiveTheme?.("app.theme:dark")
    packageRuntime.setStartupPage?.("overview")
    expect(host.preferences.getActiveTheme()).toBe("app.theme:dark")
    expect(host.preferences.getStartupPage()).toBe("overview")
    expect(packageRuntime.preferenceState?.getSnapshot()).toEqual({
      activeTheme: "app.theme:dark",
      startupPage: "overview",
    })
    host.dispose()
  })
})
