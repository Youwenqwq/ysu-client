import { describe, expect, it, vi } from "vitest"
import {
  aes128EcbDecrypt,
  aes128EcbEncrypt,
  base64ToBytes,
  bytesToBase64,
  composeApplication,
  composeBundles,
  Context,
  createObservableSource,
  createWidgetService,
  defineBundle,
  defineDictionary,
  definePlugin,
  defineStore,
  formatRouteHref,
  isCurrentNotificationDestination,
  notificationDestination,
  parseRouteLocation,
  PLUGIN_API_VERSION,
  pluginPageHref,
  trackPluginRegistration,
  WIDGETS_GENERIC_CAPABILITY,
  type HttpRequest,
  type InjectFace,
  type ObservableSource,
  type PluginSlotService,
  type PluginUIService,
  type SlotComponent,
} from "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "test.header.actions": {
      kind: "list"
      owner: { readonly title: string }
    }
    "test.panel.keyed": {
      kind: "keyed"
      owner: Record<string, never>
    }
    "test.shell.chain": {
      kind: "chain"
      owner: { readonly shellId: string }
    }
  }
}

describe("definePlugin static context narrowing & Cordis waterfall/effects", () => {
  it("exposes ONLY declared injected services plus lifecycle/event methods", () => {
    const plugin = definePlugin({
      manifest: {
        id: "test.narrowed",
        name: "Narrowed",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui", "storage"],
      configSchema: {
        type: "object",
        properties: { pageLimit: { type: "number" } },
      },
      apply(ctx, config: { pageLimit?: number }) {
        void ctx.ui
        void ctx.storage
        void ctx.effect
        void ctx.on
        void ctx.once
        void ctx.emit
        void ctx.parallel
        void ctx.serial
        void ctx.waterfall
        void ctx.bail
        void config.pageLimit

        if (false) {
          // @ts-expect-error http was not declared in inject
          void ctx.http
          // @ts-expect-error router was not declared in inject
          void ctx.router
          // @ts-expect-error raw ctx.get is not exposed on ScopedPluginContext
          void ctx.get
        }
      },
    })

    expect(plugin.manifest.inject).toEqual(["ui", "storage"])
    expect(plugin.inject).toEqual(["ui", "storage"])
    expect(plugin.manifest.configSchema).toBeDefined()
  })

  it("executes http/request waterfall hooks in order and cleans up on fork disposal", async () => {
    const root = new Context()
    await root.start()

    const fork = root.plugin((ctx) => {
      ctx.on("http/request", async (req) => ({
        ...req,
        headers: { ...req.headers, "x-plugin": "active" },
      }))
    })
    root.on("http/request", (req) => ({
      ...req,
      headers: { ...req.headers, "x-root": "1" },
    }))

    const baseRequest: HttpRequest = {
      method: "GET",
      url: "https://example.edu/api",
      redirect: "follow",
    }

    const first = await root.waterfall("http/request", baseRequest)
    expect(first.headers).toEqual({ "x-plugin": "active", "x-root": "1" })

    fork.dispose()
    const second = await root.waterfall("http/request", baseRequest)
    expect(second.headers).toEqual({ "x-root": "1" })
    await root.stop()
  })

  it("tracks registrations via ctx.effect and rejects disposed contexts before publishing", async () => {
    const root = new Context()
    await root.start()

    const cleanup = vi.fn()
    let capturedCtx!: Parameters<typeof trackPluginRegistration>[0]

    const fork = root.plugin((ctx) => {
      capturedCtx = ctx
      const earlyDispose = trackPluginRegistration(ctx, () => cleanup)
      earlyDispose()
      earlyDispose()
      expect(cleanup).toHaveBeenCalledOnce()

      trackPluginRegistration(ctx, () => cleanup)
    })

    fork.dispose()
    expect(cleanup).toHaveBeenCalledTimes(2)

    const leakedPublish = vi.fn(() => () => {})
    expect(() => trackPluginRegistration(capturedCtx, leakedPublish)).toThrow()
    expect(leakedPublish).not.toHaveBeenCalled()
    await root.stop()
  })
})

describe("SlotMap & 4-share derived component props", () => {
  const dict = defineDictionary({
    zh: { greeting: "你好 {name}" },
    en: { greeting: "Hello {name}" },
  })

  const widgetStore = defineStore({
    init: () => ({ expanded: false }),
    actions: {
      toggle(ctx) {
        ctx.set((s) => ({ expanded: !s.expanded }))
      },
    },
  })

  const badgeCountSource = createObservableSource(3)

  it("derives all 4 component shares with bare call signature and narrowed child slots", () => {
    const registrations: unknown[] = []
    const fakeSlots: PluginSlotService = {
      register(spec: unknown, component?: unknown) {
        registrations.push({ spec, component })
        return () => {}
      },
      inject() {
        return () => {}
      },
    }

    fakeSlots.register(
      {
        slot: "test.header.actions",
        order: 10,
        dictionary: dict,
        children: {
          "test.panel.keyed": { kind: "keyed" },
          "test.shell.chain": { kind: "chain" },
        },
        store: widgetStore,
        inject: () => ({
          plainLabel: "YSU",
          onRefresh: () => {},
          hooks: {
            badgeCount: badgeCountSource,
          },
        }),
      },
      (props) => {
        // Share 1: Owner + t + locale
        const ownerTitle: string = props.title
        const translated: string = props.t("greeting", { name: ownerTitle })
        const loc: "zh" | "en" = props.locale

        // Share 2: renderSlot narrowed to non-chain, renderSlotChain narrowed to chain
        const panel = props.renderSlot("test.panel.keyed", undefined, { key: "main" })
        const chained = props.renderSlotChain("test.shell.chain", { shellId: "default" }, panel)

        // Share 3: useStore + actions (never raw StoreInstance)
        const expanded: boolean = props.useStore((s) => s.expanded)
        props.actions.toggle()

        // Share 4: InjectFace (plain fields + useBadgeCount hook, no raw hooks object!)
        const plain: string = props.plainLabel
        const count: number = props.useBadgeCount()
        const doubled: number = props.useBadgeCount((n) => n * 2)
        props.onRefresh()

        if (false) {
          // @ts-expect-error cannot render undeclared root slot
          props.renderSlot("root")
          // @ts-expect-error chain slot cannot be passed to renderSlot
          props.renderSlot("test.shell.chain", { shellId: "x" })
          // @ts-expect-error non-chain slot cannot be passed to renderSlotChain
          props.renderSlotChain("test.panel.keyed", null)
          // @ts-expect-error raw hooks compartment is stripped from component props
          void props.hooks
          // @ts-expect-error invalid dictionary key rejected
          props.t("nonexistent")
        }

        void translated
        void loc
        void chained
        void expanded
        void plain
        void count
        void doubled
        return null
      }
    )

    // Keyed slot registration requires `key`
    fakeSlots.register({ slot: "test.panel.keyed", key: "main" }, (props) => {
      if (false) {
        // @ts-expect-error leaf component without children has no renderSlot prop
        void props.renderSlot
      }
      return props.locale
    })

    // Chain slot contributor receives `children` alongside owner fields
    fakeSlots.register({ slot: "test.shell.chain" }, (props) => {
      const id: string = props.shellId
      void id
      return props.children
    })

    // Bare call signature check
    const bareFn: SlotComponent<{ x: number }> = (p) => String(p.x)
    expect(bareFn({ x: 7 })).toBe("7")
    expect(registrations).toHaveLength(3)

    // Explicit InjectFace<NoInfer<I>> mapping verification
    function checkInjectFace<I>(sample: I, consume: (face: InjectFace<NoInfer<I>>) => void): void {
      void sample
      void consume
    }
    checkInjectFace(
      {
        title: "hello",
        hooks: { count: badgeCountSource as ObservableSource<number> },
      },
      (face) => {
        const str: string = face.title
        const num: number = face.useCount()
        const mapped: string = face.useCount((v) => String(v))
        void str
        void num
        void mapped
      }
    )

    // Verify registerPage on PluginUIService has same 4-share derived props & NO registerOverviewWidget
    const checkUiContract = (ui: PluginUIService) => {
      ui.registerPage(
        {
          id: "index",
          route: "schedule",
          dictionary: dict,
          store: widgetStore,
          inject: () => ({ hooks: { badgeCount: badgeCountSource } }),
        },
        (props) => {
          const text: string = props.t("greeting", { name: "test" })
          const open: boolean = props.useStore((s) => s.expanded)
          const badge: number = props.useBadgeCount()
          return `${text}:${open}:${badge}`
        }
      )
      if (false) {
        // @ts-expect-error registerOverviewWidget was removed from PluginUIService in v3
        void ui.registerOverviewWidget
      }
    }
    void checkUiContract
  })
})

describe("defineBundle, composeBundles, composeApplication", () => {
  const bundlePlatform = defineBundle({
    id: "bundle-platform",
    defaults: { shell: "orahako.shell:default" },
    nativeCapabilities: ["native.files@1", "widgets.generic@1"],
    plugins: [
      { id: "orahako.runtime.ui", protected: true },
      { id: "orahako.runtime.session", config: { defaultSchoolId: "none" }, protected: true },
      { id: "orahako.shell", protected: true },
    ],
  })

  const bundleAcademic = defineBundle({
    id: "bundle-academic",
    defaults: { landing: "overview" },
    nativeCapabilities: ["widgets.generic@1", "academic.polling@1"],
    plugins: [{ id: "orahako.overview" }, { id: "orahako.schedule" }],
  })

  const bundleYsu = defineBundle({
    id: "bundle-ysu",
    defaults: { schoolId: "ysu" },
    market: { indexUrl: "https://market.orahako.example/plugins.json" },
    plugins: [{ id: "orahako.ysu", protected: true }],
    patches: [{ id: "orahako.runtime.session", config: { defaultSchoolId: "ysu" } }],
  })

  it("stacks pure-data bundles in order and applies optional patch layers", () => {
    const composed = composeBundles(
      "orahako.official",
      [bundlePlatform, bundleAcademic, bundleYsu],
      [
        {
          id: "layer.custom",
          defaults: { landing: "schedule" },
          plugins: [
            { id: "orahako.overview", disabled: true },
            { insert: [{ id: "orahako.extra" }] },
          ],
        },
      ]
    )

    expect(composed.id).toBe("orahako.official")
    expect(composed.defaults).toEqual({
      shell: "orahako.shell:default",
      landing: "schedule",
      schoolId: "ysu",
    })
    expect(composed.nativeCapabilities).toEqual([
      "native.files@1",
      "widgets.generic@1",
      "academic.polling@1",
    ])
    expect(composed.market).toEqual({ indexUrl: "https://market.orahako.example/plugins.json" })
    expect(composed.plugins.map((p) => p.id)).toEqual([
      "orahako.runtime.ui",
      "orahako.runtime.session",
      "orahako.shell",
      "orahako.overview",
      "orahako.schedule",
      "orahako.ysu",
      "orahako.extra",
    ])
    expect(composed.plugins.find((p) => p.id === "orahako.runtime.session")?.config).toEqual({
      defaultSchoolId: "ysu",
    })
    expect(composed.plugins.find((p) => p.id === "orahako.overview")?.disabled).toBe(true)
  })

  it("rejects duplicate entries and unknown patch targets loudly", () => {
    expect(() =>
      composeBundles([
        bundlePlatform,
        defineBundle({ id: "dup", plugins: [{ id: "orahako.shell" }] }),
      ])
    ).toThrow("Duplicate composition entry: orahako.shell")

    const base = composeBundles([bundlePlatform])
    expect(() =>
      composeApplication(base, [{ id: "bad", plugins: [{ id: "unknown.plugin", disabled: true }] }])
    ).toThrow("Unknown composition entry unknown.plugin in bad")
  })
})

describe("router, deep-link, crypto & widget helpers", () => {
  it("parses and formats query-string routes on /", () => {
    expect(formatRouteHref("schedule")).toBe("/?route=schedule")
    expect(formatRouteHref({ route: "schedule", params: { week: 4 } })).toBe(
      "/?route=schedule&week=4"
    )
    expect(
      formatRouteHref({ pluginId: "orahako.schedule", pageId: "editor", params: { day: 2 } })
    ).toBe("/?plugin=orahako.schedule&page=editor&day=2")

    const loc = parseRouteLocation("/?plugin=orahako.schedule&page=editor&day=2")
    expect(loc).toEqual({
      pathname: "/",
      search: "?plugin=orahako.schedule&page=editor&day=2",
      href: "/?plugin=orahako.schedule&page=editor&day=2",
      pluginId: "orahako.schedule",
      pageId: "editor",
      params: { day: "2" },
    })
  })

  it("maps deep-link notifications through PluginNavigationService", () => {
    const nav = {
      resolve: (id: string) =>
        id === "schedule"
          ? ({ pluginId: "orahako.schedule", pageId: "index", source: "page" } as const)
          : undefined,
      sources: () => ({ pages: [], navigation: [], fallbackHref: "/?route=me" }),
    }
    const dest = notificationDestination("orahako://schedule", nav, "orahako")
    expect(dest).toBe(pluginPageHref("orahako.schedule", "index"))
    expect(
      isCurrentNotificationDestination("/", "?plugin=orahako.schedule&page=index", dest!)
    ).toBe(true)
    expect(notificationDestination("other://schedule", nav, "orahako")).toBeNull()
  })

  it("round-trips AES-128-ECB + Base64", () => {
    const key = new TextEncoder().encode("0123456789abcdef")
    const plain = new TextEncoder().encode("hello orahako v3!")
    const encryptedB64 = bytesToBase64(aes128EcbEncrypt(key, plain))
    const decrypted = aes128EcbDecrypt(key, base64ToBytes(encryptedB64))
    expect(new TextDecoder().decode(decrypted)).toBe("hello orahako v3!")
  })

  it("invokes generic widget capabilities through createWidgetService", async () => {
    const invoke = vi.fn(async (_id: string, method: string) => {
      if (method === "list") {
        return {
          widgets: [
            { id: "schedule", provider: "ScheduleWidget", capability: "widgets.schedule@1" },
          ],
        }
      }
      if (method === "pin") return { added: true }
      return {}
    })
    const service = createWidgetService({
      capabilities: {
        list: () => [
          { id: "widgets.generic", version: 1, methods: ["list", "pin", "update", "clear"] },
        ],
        has: (id) => id === WIDGETS_GENERIC_CAPABILITY,
        acquire: async () => async () => {},
        invoke: invoke as never,
      },
    })
    const widgets = await service.list()
    expect(widgets).toHaveLength(1)
    expect(await service.requestPin("schedule")).toBe(true)
    await service.clear("schedule")
    expect(invoke).toHaveBeenCalledTimes(3)
  })
})
