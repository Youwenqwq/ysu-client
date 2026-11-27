import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const capUpdaterMocks = vi.hoisted(() => ({
  notifyAppReady: vi.fn(async () => {}),
  addListener: vi.fn(async () => ({ remove: async () => {} })),
  download: vi.fn(async () => ({ id: "bundle-1" })),
  next: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
}))

const capAppMocks = vi.hoisted(() => ({
  getInfo: vi.fn(async () => ({
    build: "100",
    version: "1.0.0",
    id: "me.uwen.orahako",
    name: "Orahako",
  })),
}))

vi.mock("@capgo/capacitor-updater", () => ({
  CapacitorUpdater: capUpdaterMocks,
}))

vi.mock("@capacitor/app", () => ({
  App: capAppMocks,
}))

import { PluginRuntime } from "@orahako/kernel"
import { i18nRegistryPlugin, type PluginI18nRegistry } from "@orahako/runtime-i18n"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { createScopedStorage, storageRuntimePlugin } from "@orahako/runtime-storage"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginKeyValueStorage,
  type PluginNativeService,
} from "@orahako/sdk"
import {
  ConfiguredUpdateService,
  createPwaController,
  isNewer,
  updaterPlugin,
  updaterRuntimeStore,
  type PluginUpdateService,
} from "../src/index"

function memoryStorage(): PluginKeyValueStorage {
  const entries = new Map<string, string>()
  return {
    getItem: async (key) => entries.get(key) ?? null,
    setItem: async (key, value) => {
      entries.set(key, value)
    },
    removeItem: async (key) => {
      entries.delete(key)
    },
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("@orahako/ui-updater", () => {
  beforeEach(() => {
    capUpdaterMocks.notifyAppReady.mockClear()
    capUpdaterMocks.download.mockClear()
    capUpdaterMocks.next.mockClear()
    capUpdaterMocks.reload.mockClear()
    capUpdaterMocks.reset.mockClear()
    capAppMocks.getInfo.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reads release manifests, mirrors only allowed origins, enforces cooldowns, and compares channels", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        webVersion: "1.2.0",
        webDownloadUrl: "https://downloads.example.test/bundle.zip",
        body: "Release notes",
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    let now = 1_000_000
    const service = new ConfiguredUpdateService({
      manifestUrl: "https://orahako.example.test/api/version",
      currentVersion: "1.0.0",
      mirrors: [
        { label: "Direct", value: "" },
        { label: "Mirror", value: "https://mirror.example.test/" },
      ],
      mirrorableOrigins: ["https://downloads.example.test"],
      checkCooldownMs: 60_000,
      storage: memoryStorage(),
      now: () => now,
    })

    expect(service.getMirrors()).toHaveLength(2)
    const mirrored = await service.checkForUpdate({ mirror: "https://mirror.example.test/" })
    expect(fetchMock).toHaveBeenCalledWith("https://orahako.example.test/api/version")
    expect(mirrored).toEqual({
      available: true,
      version: "1.2.0",
      downloadUrl: "https://mirror.example.test/https://downloads.example.test/bundle.zip",
      body: "Release notes",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    })

    // Non-mirrorable asset origin stays untouched
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        webVersion: "1.2.0",
        webDownloadUrl: "https://other.example.test/bundle.zip",
      })
    )
    const nonMirrored = await service.checkForUpdate({ mirror: "https://mirror.example.test/" })
    expect(nonMirrored.downloadUrl).toBe("https://other.example.test/bundle.zip")

    // Cooldown applies to automatic checks only
    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: true })
    const callsAfterAuto1 = fetchMock.mock.calls.length

    now += 30_000
    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: false })
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterAuto1)

    now += 60_000
    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: true })

    // Rate limit 403 throws on manual check, folds to empty on automatic check
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 403 }))
    await expect(service.checkForUpdate()).rejects.toThrow("RATE_LIMIT")
    await expect(
      service.checkForUpdate({ automatic: true, channel: "beta" })
    ).resolves.toMatchObject({
      available: false,
      version: "",
    })

    // Semver channel comparison (stable < beta/rc < canary/alpha)
    expect(isNewer("1.0.0", "1.1.0")).toBe(true)
    expect(isNewer("1.1.0", "1.1.0")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-beta.1", "stable")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-beta.1", "beta")).toBe(true)
    expect(isNewer("1.0.0", "1.1.0-rc.1", "beta")).toBe(true)
    expect(isNewer("1.0.0", "1.1.0-alpha.1", "beta")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-canary.1", "beta")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-alpha.1", "canary")).toBe(true)
    expect(isNewer("1.0.0", "1.1.0-canary.1", "canary")).toBe(true)
    expect(isNewer("1.0.0", "1.1.0-beta.1", "canary")).toBe(true)

    // Empty manifestUrl returns EMPTY_UPDATE safely
    const unconfigured = new ConfiguredUpdateService({ currentVersion: "1.0.0" })
    await expect(unconfigured.checkForUpdate()).resolves.toMatchObject({ available: false })
  })

  it("respects minApkVersionCode when choosing between Web OTA and APK updates on native", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const service = new ConfiguredUpdateService({
      manifestUrl: "https://orahako.example.test/api/version",
      currentVersion: "1.0.0",
      native: {
        isNative: true,
        capabilities: {} as PluginNativeService["capabilities"],
      },
    })

    // Installed build is 100; beta Web OTA requires minApkVersionCode 100 -> Web OTA is offered
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        webVersion: "1.0.0",
        apkVersionCode: 100,
        channels: {
          stable: {
            webVersion: "1.0.0",
            apkVersionCode: 100,
            apkDownloadUrl: "https://downloads.example.test/app-1.0.0.apk",
          },
          beta: {
            webVersion: "1.1.0-rc.1",
            webDownloadUrl: "https://downloads.example.test/dist-1.1.0-rc.1.zip",
            minApkVersionCode: 100,
            body: "Beta OTA",
          },
          canary: {
            webVersion: "1.2.0-canary.1",
            webDownloadUrl: "https://downloads.example.test/dist-1.2.0-canary.1.zip",
            minApkVersionCode: 100,
            body: "Canary OTA",
          },
        },
      })
    )
    await expect(service.checkForUpdate({ channel: "beta" })).resolves.toEqual({
      available: true,
      version: "1.1.0-rc.1",
      downloadUrl: "https://downloads.example.test/dist-1.1.0-rc.1.zip",
      body: "Beta OTA",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    })

    // Canary channel sees canary > beta > stable
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        webVersion: "1.0.0",
        apkVersionCode: 100,
        channels: {
          stable: {
            webVersion: "1.0.0",
            apkVersionCode: 100,
            apkDownloadUrl: "https://downloads.example.test/app-1.0.0.apk",
          },
          beta: {
            webVersion: "1.1.0-rc.1",
            webDownloadUrl: "https://downloads.example.test/dist-1.1.0-rc.1.zip",
            minApkVersionCode: 100,
            body: "Beta OTA",
          },
          canary: {
            webVersion: "1.2.0-canary.1",
            webDownloadUrl: "https://downloads.example.test/dist-1.2.0-canary.1.zip",
            minApkVersionCode: 100,
            body: "Canary OTA",
          },
        },
      })
    )
    await expect(service.checkForUpdate({ channel: "canary" })).resolves.toEqual({
      available: true,
      version: "1.2.0-canary.1",
      downloadUrl: "https://downloads.example.test/dist-1.2.0-canary.1.zip",
      body: "Canary OTA",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    })

    // Beta Web OTA requires minApkVersionCode 110 > installed build 100 -> falls back to APK update
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        webVersion: "1.1.0",
        apkVersionCode: 110,
        apkDownloadUrl: "https://downloads.example.test/app-1.1.0.apk",
        body: "Stable native",
        channels: {
          stable: {
            webVersion: "1.1.0",
            apkVersionCode: 110,
            apkDownloadUrl: "https://downloads.example.test/app-1.1.0.apk",
            body: "Stable native",
          },
          beta: {
            webVersion: "1.2.0-rc.1",
            webDownloadUrl: "https://downloads.example.test/dist-1.2.0-rc.1.zip",
            minApkVersionCode: 110,
            body: "Beta OTA",
          },
        },
      })
    )
    await expect(service.checkForUpdate({ channel: "beta" })).resolves.toEqual({
      available: false,
      version: "1.1.0",
      downloadUrl: "https://downloads.example.test/dist-1.2.0-rc.1.zip",
      body: "Stable native",
      apkUpdateAvailable: true,
      apkDownloadUrl: "https://downloads.example.test/app-1.1.0.apk",
    })
  })

  it("notifies CapacitorUpdater on native startup, provides updater service, and contributes overlay/settings/about slots", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          webVersion: "1.3.0",
          apkVersionCode: 120,
          apkDownloadUrl: "https://downloads.example.test/app-1.3.0.apk",
          body: "## Faster launch",
        })
      )
    )

    const invokeSpy = vi.fn(async (_id: string, method: string) => {
      if (method === "downloadApk") return { path: "/cache/app-1.3.0.apk" }
      return {}
    })

    const fakeNativePlugin = definePlugin({
      manifest: {
        id: "test.native",
        name: "Fake Native",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
        provides: ["native"],
      },
      apply(ctx) {
        const nativeService: PluginNativeService = {
          isNative: true,
          capabilities: {
            list: () => [
              { id: "native.files", version: 1, methods: ["downloadApk", "installApk"] },
            ],
            has: () => true,
            acquire: async () => async () => {},
            invoke: invokeSpy as PluginNativeService["capabilities"]["invoke"],
          },
          saveImage: async () => ({ uri: "file:///img.png" }),
          requestNotificationPermission: async () => true,
          requestExactAlarmPermission: async () => true,
          requestBatteryOptimizationExemption: async () => true,
        }
        ctx.set("native", nativeService)
      },
    })

    const runtime = new PluginRuntime()
    try {
      runtime.register(slotRegistryPlugin, "builtin")
      runtime.register(i18nRegistryPlugin, "builtin")
      runtime.register(storageRuntimePlugin, "builtin")
      runtime.register(fakeNativePlugin, "builtin")
      runtime.register(updaterPlugin, "builtin", {
        manifestUrl: "https://orahako.example.test/api/version",
        currentVersion: "1.0.0",
        mirrors: [
          { label: "直连", value: "" },
          { label: "镜像", value: "https://mirror.example.test/" },
        ],
        mirrorableOrigins: ["https://downloads.example.test"],
      })

      for (const id of [
        slotRegistryPlugin.manifest.id,
        i18nRegistryPlugin.manifest.id,
        storageRuntimePlugin.manifest.id,
        fakeNativePlugin.manifest.id,
        updaterPlugin.manifest.id,
      ]) {
        await runtime.startAndWait(id)
      }

      expect(capUpdaterMocks.notifyAppReady).toHaveBeenCalledOnce()

      const updater = runtime.context.get("updater") as PluginUpdateService
      expect(updater).toBeDefined()
      const apkInfo = await updater.checkForUpdate()
      expect(apkInfo.apkUpdateAvailable).toBe(true)
      expect(apkInfo.version).toBe("1.3.0")

      await updater.downloadApkInApp(apkInfo)
      await updater.installDownloadedApk()
      expect(invokeSpy).toHaveBeenCalledWith("native.files", "downloadApk", {
        url: "https://downloads.example.test/app-1.3.0.apk",
      })
      expect(invokeSpy).toHaveBeenCalledWith("native.files", "installApk", {
        path: "/cache/app-1.3.0.apk",
      })

      const slots = runtime.context.get("slots") as PluginSlotRegistry
      const i18n = runtime.context.get("i18n") as PluginI18nRegistry
      slots.declare({ name: "shell.overlay", kind: "list" })
      slots.declare({ name: "settings.general", kind: "list" })
      slots.declare({ name: "about.extra", kind: "list" })

      const overlayEntry = slots.select("shell.overlay")[0]!
      const aboutEntry = slots.select("about.extra")[0]!
      expect(overlayEntry).toBeDefined()
      expect(aboutEntry).toBeDefined()
      expect(slots.select("settings.general")).toHaveLength(0)

      const aboutHtml = renderToStaticMarkup(
        <ContributionOutlet entry={aboutEntry} slots={slots} i18n={i18n} />
      )
      expect(aboutHtml).toContain("检查更新")
      expect(aboutHtml).toContain("1.0.0")

      // Trigger PWA banner state on runtime store and verify banner renders cleanly
      const rtStore = overlayEntry.store as ReturnType<typeof updaterRuntimeStore.create>
      rtStore.actions.setPwaUpdateAvailable(true)
      const overlayHtml = renderToStaticMarkup(
        <ContributionOutlet entry={overlayEntry} slots={slots} i18n={i18n} />
      )
      expect(overlayHtml).toContain("data-pwa-update-banner")
      expect(overlayHtml).toContain("发现新版本，刷新后生效")
    } finally {
      runtime.dispose()
    }
  })

  it("tracks PWA install state and persists dismissed SW updates in scoped storage", async () => {
    const scoped = createScopedStorage("orahako.updater")
    let bannerVisible = false
    const pwa = createPwaController({
      storage: scoped.local,
      isNative: () => false,
      enableServiceWorker: false,
      onUpdateAvailable: (v) => {
        bannerVisible = v
      },
    })

    bannerVisible = true
    await pwa.dismissWebUpdate()
    expect(bannerVisible).toBe(false)
    expect(await scoped.local.getItem("pwa-dismissed-update")).toBe("unknown")
    pwa.dispose()
  })

  it("registers the PWA service worker when enableServiceWorker is explicitly enabled", async () => {
    const register = vi.fn().mockResolvedValue({
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined),
    })

    const originalWindow = globalThis.window
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        isSecureContext: true,
        location: { origin: "https://orahako.welain.com" },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        userAgent: "Mozilla/5.0",
        serviceWorker: {
          controller: null,
          register,
          getRegistration: vi.fn().mockResolvedValue(null),
          ready: Promise.resolve({}),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      },
    })

    const webNativePlugin = definePlugin({
      manifest: {
        id: "test.web-native",
        name: "Test Web Native",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
        provides: ["native"],
      },
      apply(ctx) {
        const nativeService: PluginNativeService = {
          isNative: false,
          capabilities: {
            list: () => [],
            has: () => false,
            acquire: async () => async () => {},
            invoke: (async () => undefined) as PluginNativeService["capabilities"]["invoke"],
          },
          saveImage: async () => ({ uri: "file:///img.png" }),
          requestNotificationPermission: async () => false,
          requestExactAlarmPermission: async () => false,
          requestBatteryOptimizationExemption: async () => false,
        }
        ctx.set("native", nativeService)
      },
    })

    const runtime = new PluginRuntime()
    try {
      runtime.register(slotRegistryPlugin, "builtin")
      runtime.register(i18nRegistryPlugin, "builtin")
      runtime.register(storageRuntimePlugin, "builtin")
      runtime.register(webNativePlugin, "builtin")
      runtime.register(updaterPlugin, "builtin", {
        currentVersion: "0.15.0",
        basePath: "/app",
        enableServiceWorker: true,
      })

      for (const id of [
        slotRegistryPlugin.manifest.id,
        i18nRegistryPlugin.manifest.id,
        storageRuntimePlugin.manifest.id,
        webNativePlugin.manifest.id,
        updaterPlugin.manifest.id,
      ]) {
        await runtime.startAndWait(id)
      }

      expect(register).toHaveBeenCalledWith("/app/sw.js", { updateViaCache: "none" })
    } finally {
      runtime.dispose()
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      })
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
      })
    }
  })
})
