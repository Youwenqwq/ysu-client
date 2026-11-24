import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { PluginHost, PluginRuntime } from "@orahako/kernel"
import {
  defineDictionary,
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type CompositionSource,
  type HttpRequest,
} from "@orahako/sdk"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, PluginRouter, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import { ContributionOutlet, OrahakoApp, slotRegistryPlugin } from "@orahako/runtime-slots"
import { NamespacedStorageService, storageRuntimePlugin } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  applyCustomUserAgentHeader,
  manifest,
  normalizeCustomUserAgent,
  SETTINGS_PLUGIN_ID,
  settingsStore,
  uiSettingsPlugin,
} from "../src"

function DummyIcon() {
  return null
}

describe("@orahako/ui-settings", () => {
  it("validates API v1 manifest and normalizes & applies Custom User-Agent headers", () => {
    const validated = validatePluginManifest(manifest)
    expect(validated.id).toBe(SETTINGS_PLUGIN_ID)
    expect(validated.kind).toBe("feature")
    expect(validated.providerIndependent).toBe(true)
    expect(validated.required).toBe(true)
    expect(validated.inject).toEqual([
      "ui",
      "slots",
      "settings",
      "router",
      "i18n",
      "storage",
      "http",
    ])

    expect(normalizeCustomUserAgent("  Mozilla/5.0   Custom\nAgent  ")).toBe(
      "Mozilla/5.0 Custom Agent"
    )

    const baseReq: HttpRequest = {
      method: "GET",
      url: "https://example.edu.cn/api",
      headers: { "user-agent": "OldAgent/1.0", Accept: "application/json" },
      redirect: "follow",
    }

    // Disabled -> untouched
    expect(
      applyCustomUserAgentHeader(baseReq, {
        customUserAgentEnabled: false,
        customUserAgent: "Orahako/3.0",
      })
    ).toBe(baseReq)

    // Enabled with blank UA -> untouched
    expect(
      applyCustomUserAgentHeader(baseReq, {
        customUserAgentEnabled: true,
        customUserAgent: "   ",
      })
    ).toBe(baseReq)

    // Enabled with non-empty UA -> case-insensitively replaces user-agent
    const overridden = applyCustomUserAgentHeader(baseReq, {
      customUserAgentEnabled: true,
      customUserAgent: "  Orahako/3.0   Test ",
    })
    expect(overridden.headers).toEqual({
      Accept: "application/json",
      "User-Agent": "Orahako/3.0 Test",
    })
  })

  it("overrides outgoing HTTP request User-Agent via Cordis http/request waterfall when enabled", async () => {
    const capturedUaHeaders: Array<string | null> = []
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const headers = new Headers(init?.headers)
      capturedUaHeaders.push(headers.get("x-proxy-ua"))
      return new Response("ok", { status: 200 })
    })

    try {
      const memoryKv = new Map<string, string>()
      const kvBackend = {
        getItem: async (k: string) => memoryKv.get(k) ?? null,
        setItem: async (k: string, v: string) => {
          memoryKv.set(k, v)
        },
        removeItem: async (k: string) => {
          memoryKv.delete(k)
        },
      }

      // Pre-seed persisted custom UA in scoped storage for orahako.settings
      memoryKv.set(
        `orahako-plugin:${SETTINGS_PLUGIN_ID}:preferences`,
        JSON.stringify({
          version: 1,
          state: {
            customUserAgentEnabled: true,
            customUserAgent: "CustomOrahakoUA/3.1",
            startupPage: "",
          },
        })
      )

      const runtime = new PluginRuntime()
      const storage = new NamespacedStorageService({ local: kvBackend, secure: kvBackend })
      const httpService = new StatelessHttpService({
        ctx: runtime.context,
        isNative: () => false,
      })

      runtime.context.set("storage", storage)
      runtime.context.set("http", httpService)
      runtime.register(slotRegistryPlugin, "builtin")
      runtime.register(uiRegistryPlugin, "builtin")
      runtime.register(i18nRegistryPlugin, "builtin")
      runtime.register(routerRuntimePlugin, "builtin")
      runtime.register(settingsRegistryPlugin, "builtin")
      runtime.register(uiSettingsPlugin, "builtin")

      const senderPlugin = definePlugin({
        manifest: {
          id: "example.sender",
          name: "Sender",
          version: "1.0.0",
          apiVersion: PLUGIN_API_VERSION,
          kind: "feature",
          entry: "index.js",
        },
        inject: ["http"],
        async apply(ctx) {
          await ctx.http.send({
            method: "GET",
            url: "https://service.example.com/ping",
            headers: { "user-agent": "DefaultBrowser/1.0" },
            redirect: "manual",
          })
        },
      })
      runtime.register(senderPlugin, "builtin")

      runtime.start(slotRegistryPlugin.manifest.id)
      runtime.start(uiRegistryPlugin.manifest.id)
      runtime.start(i18nRegistryPlugin.manifest.id)
      runtime.start(routerRuntimePlugin.manifest.id)
      runtime.start(settingsRegistryPlugin.manifest.id)
      runtime.start(uiSettingsPlugin.manifest.id)
      await runtime.flush()

      // Wait for async hydration of persisted store
      await vi.waitFor(async () => {
        capturedUaHeaders.length = 0
        runtime.stop(senderPlugin.manifest.id)
        await runtime.startAndWait(senderPlugin.manifest.id)
        expect(capturedUaHeaders[0]).toBe("CustomOrahakoUA/3.1")
      })

      // Stopping uiSettingsPlugin removes the http/request listener cleanly
      runtime.stop(uiSettingsPlugin.manifest.id)
      capturedUaHeaders.length = 0
      runtime.stop(senderPlugin.manifest.id)
      await runtime.startAndWait(senderPlugin.manifest.id)
      expect(capturedUaHeaders[0]).toBe("DefaultBrowser/1.0")

      runtime.dispose()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it("renders settings page slots, category list links, and category detail panel via 'settings.category.panel'", async () => {
    const categoryDict = defineDictionary({
      zh: { title: "通知渠道", desc: "管理推送渠道", panelText: "渠道状态:{flag}" },
      en: {
        title: "Notification Channels",
        desc: "Manage push channels",
        panelText: "Status:{flag}",
      },
    })

    const catStore = defineStore({
      init: () => ({ flag: "enabled" }),
      actions: {},
    })

    const mockShell = definePlugin({
      manifest: {
        id: "test.shell",
        name: "Test Shell",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerShell({ id: "default", name: "Test" }, (props) => (
          <main>{props.children}</main>
        ))
      },
    })

    const contributor = definePlugin({
      manifest: {
        id: "example.contributor",
        name: "Contributor",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["slots", "settings"],
      apply(ctx) {
        ctx.slots.inject("settings.appearance", (sCtx) =>
          sCtx.slots.register({ id: "app-item", slot: "settings.appearance" }, () => (
            <div>APPEARANCE_CONTRIB</div>
          ))
        )
        ctx.slots.inject("settings.general", (sCtx) =>
          sCtx.slots.register({ id: "gen-item", slot: "settings.general" }, () => (
            <div>GENERAL_CONTRIB</div>
          ))
        )
        ctx.slots.inject("settings.account", (sCtx) =>
          sCtx.slots.register({ id: "acc-item", slot: "settings.account" }, () => (
            <div>ACCOUNT_CONTRIB</div>
          ))
        )
        ctx.settings.registerCategory(
          {
            id: "channels",
            titleKey: "title",
            descriptionKey: "desc",
            icon: DummyIcon,
            dictionary: categoryDict,
            store: catStore,
          },
          (props) => {
            const flag = props.useStore((s) => s.flag)
            return <div>{props.t("panelText", { flag })}</div>
          }
        )
      },
    })

    const httpStub = definePlugin({
      manifest: {
        id: "orahako.runtime.http",
        name: "HTTP Stub",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
        provides: ["http"],
      },
      apply(ctx) {
        ctx.set("http", new StatelessHttpService({ ctx }))
      },
    })

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "test-settings",
      composition: {
        id: "test.settings",
        version: 1,
        defaults: { shell: "test.shell:default" },
        plugins: [
          { id: "orahako.runtime.storage", protected: true },
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
          { id: "orahako.runtime.i18n", protected: true },
          {
            id: "orahako.runtime.router",
            protected: true,
            config: { initialHref: "/?plugin=orahako.settings&page=settings" },
          },
          { id: "orahako.runtime.navigation", protected: true },
          { id: "orahako.runtime.settings", protected: true },
          { id: "orahako.runtime.http", protected: true },
          { id: "test.shell", protected: true },
          { id: SETTINGS_PLUGIN_ID, protected: true },
          { id: "example.contributor" },
        ],
      },
      plugins: [
        storageRuntimePlugin,
        slotRegistryPlugin,
        uiRegistryPlugin,
        i18nRegistryPlugin,
        routerRuntimePlugin,
        navigationRuntimePlugin,
        settingsRegistryPlugin,
        httpStub,
        mockShell,
        uiSettingsPlugin,
        contributor,
      ],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()
    const router = host.runtime.context.get("router") as PluginRouter

    // Render Settings page
    const settingsHtml = renderToStaticMarkup(<OrahakoApp host={host} />)
    expect(settingsHtml).toContain("APPEARANCE_CONTRIB")
    expect(settingsHtml).toContain("GENERAL_CONTRIB")
    expect(settingsHtml).toContain("ACCOUNT_CONTRIB")
    expect(settingsHtml).toContain("通知渠道")
    expect(settingsHtml).toContain("管理推送渠道")
    expect(settingsHtml).toContain(
      'href="/?plugin=orahako.settings&amp;page=category&amp;category=channels"'
    )

    // Switch locale to English and verify category row & labels localize
    host.i18n?.setLocale("en")
    const settingsEnHtml = renderToStaticMarkup(<OrahakoApp host={host} />)
    expect(settingsEnHtml).toContain("Notification Channels")
    expect(settingsEnHtml).toContain("Manage push channels")

    // Navigate to category detail page -> renders bridged keyed slot contribution!
    router.push("/?plugin=orahako.settings&page=category&category=channels")
    const categoryHtml = renderToStaticMarkup(<OrahakoApp host={host} />)
    expect(categoryHtml).toContain("Notification Channels")
    expect(categoryHtml).toContain("Status:enabled")

    // Navigate to unknown category -> renders localized unavailable category state
    router.push("/?plugin=orahako.settings&page=category&category=nonexistent")
    const missingCatHtml = renderToStaticMarkup(<OrahakoApp host={host} />)
    expect(missingCatHtml).toContain("Settings category unavailable")

    // Also verify settingsStore standalone actions
    const standaloneStore = settingsStore.create()
    standaloneStore.actions.setStartupPage("schedule")
    expect(standaloneStore.source.getSnapshot().startupPage).toBe("schedule")
    standaloneStore.dispose()

    // Verify debug panel slot contribution renders cleanly via ContributionOutlet
    const disposeDebugSlot = host.slots!.declare({ name: "debug.panels", kind: "list" })
    const debugPanelEntry = host.slots!.select("debug.panels")[0]!
    const debugPanelHtml = renderToStaticMarkup(
      <ContributionOutlet entry={debugPanelEntry} slots={host.slots} i18n={host.i18n} />
    )
    expect(debugPanelHtml).toContain("Request User-Agent")
    disposeDebugSlot()

    host.dispose()
  })
})
