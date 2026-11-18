import { zipSync } from "fflate"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as SdkNamespace from "@orahako/sdk"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionSource,
  type MarketplaceIndex,
  type PluginManifest,
} from "@orahako/sdk"
import {
  beginPluginBoot,
  createMemoryPackageBackend,
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

  it("preflights and installs API v3 marketplace bundles in dependency order", async () => {
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
            apiVersion: 2, // Historical v2 release ignored by v3 selector!
            platforms: ["web", "android"],
            zipUrl: `/v2/${id}.zip`,
            sha256: "f".repeat(64),
            size: 50,
            publishedAt: "2026-11-01T00:00:00Z",
          },
          {
            version: "1.0.0",
            apiVersion: 3,
            platforms: ["web", "android"],
            zipUrl: `/v3/${id}.zip`,
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

    const installedOrder: string[] = []
    vi.spyOn(host, "installFromUrl").mockImplementation(async (url, _sha, expected) => {
      expect(url).toContain("/v3/")
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

    await host.applyPluginBundle(["ext.consumer"], index)
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
          apiVersion: 3,
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
          apiVersion: 3,
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
          apiVersion: 3,
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
})
