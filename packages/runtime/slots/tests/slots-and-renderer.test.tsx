import { act, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginHost, PluginRuntime } from "@orahako/kernel"
import {
  createObservableSource,
  defineDictionary,
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type CompositionSource,
  type PluginStorageService,
  type ScopedPluginService,
} from "@orahako/sdk"
import { i18nRegistryPlugin, PluginI18nRegistry } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, PluginRouter, routerRuntimePlugin } from "@orahako/runtime-router"
import { PluginSettingsRegistry } from "@orahako/runtime-settings"
import { PluginUIRegistry, uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  ContributionOutlet,
  OrahakoApp,
  PluginSlotRegistry,
  SLOTS_RUNTIME_PLUGIN_ID,
  slotRegistryPlugin,
} from "../src"

declare module "@orahako/sdk" {
  interface SlotMap {
    "test.parent": {
      kind: "single"
      owner: { readonly heading: string }
    }
    "test.child.list": {
      kind: "list"
      owner: { readonly prefix: string }
    }
    "test.child.keyed": {
      kind: "keyed"
      owner: Record<string, never>
    }
    "test.child.chain": {
      kind: "chain"
      owner: { readonly tag: string }
    }
    "test.empty.chain": {
      kind: "chain"
      owner: Record<string, never>
    }
    "test.deferred": {
      kind: "list"
      owner: Record<string, never>
    }
  }
}

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniDomNode[] = []
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = undefined
  activeElement: unknown = null
  nodeValue?: string
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) {
      this.tagName = nodeName
    }
  }

  get firstChild(): MiniDomNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniDomNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index >= 0 ? (this.parentNode.childNodes[index + 1] ?? null) : null
  }

  appendChild(child: MiniDomNode): MiniDomNode {
    if (child.parentNode) {
      child.parentNode.removeChild(child)
    }
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniDomNode, before: MiniDomNode | null): MiniDomNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) {
      child.parentNode.removeChild(child)
    }
    const index = this.childNodes.indexOf(before)
    child.parentNode = this
    if (index >= 0) {
      this.childNodes.splice(index, 0, child)
    } else {
      this.childNodes.push(child)
    }
    return child
  }

  removeChild(child: MiniDomNode): MiniDomNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) {
      this.childNodes.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  set textContent(value: string) {
    this.childNodes.length = 0
    this.rawText = String(value)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((child) => child.textContent).join("")
  }

  toHtml(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    const inner =
      this.childNodes.length > 0
        ? this.childNodes.map((child) => child.toHtml()).join("")
        : this.rawText
    if (this.nodeType !== 1) return inner
    const tag = this.nodeName.toLowerCase()
    const attrs = Array.from(this.attributes.entries())
      .map(([k, v]) => ` ${k}="${v}"`)
      .join("")
    return `<${tag}${attrs}>${inner}</${tag}>`
  }
}

function mountInteractiveDom() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { reload: vi.fn() },
  }
  const doc = new MiniDomNode(9, "#document")
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    createElement(tag: string) {
      const el = new MiniDomNode(1, tag.toUpperCase())
      el.ownerDocument = docWithFactories
      return el
    },
    createElementNS(_ns: string, tag: string) {
      return docWithFactories.createElement(tag)
    },
    createTextNode(text: string) {
      const node = new MiniDomNode(3, "#text")
      node.nodeValue = String(text)
      node.ownerDocument = docWithFactories
      return node
    },
    createComment(text: string) {
      const node = new MiniDomNode(8, "#comment")
      node.nodeValue = String(text)
      node.ownerDocument = docWithFactories
      return node
    },
  })

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docWithFactories

  const container = docWithFactories.createElement("div")
  const root = createRoot(container as never)

  return {
    container,
    fakeWin,
    async render(node: React.ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct
      ;(globalThis as Record<string, unknown>).window = prevWindow
      ;(globalThis as Record<string, unknown>).document = prevDocument
    },
  }
}

let activeUnmount: (() => Promise<void>) | undefined
afterEach(async () => {
  if (activeUnmount) {
    const fn = activeUnmount
    activeUnmount = undefined
    await fn()
  }
})

describe("PluginSlotRegistry & slotRegistryPlugin", () => {
  it("pre-declares 'root' at construction and rejects duplicate root declaration", () => {
    const registry = new PluginSlotRegistry()
    expect(registry.getSnapshot().declarations).toEqual([{ name: "root", kind: "single" }])
    expect(() => registry.declare({ name: "root", kind: "single" })).toThrow(
      "Plugin slot already declared: root"
    )
  })

  it("validates declared targets, keyed keys, single/keyed priority ambiguity, and child slot lifecycles", () => {
    const runtime = new PluginRuntime()
    runtime.register(slotRegistryPlugin, "builtin")
    runtime.start(SLOTS_RUNTIME_PLUGIN_ID)
    const registry = runtime.context.get("slots") as PluginSlotRegistry

    // Undeclared target throws loud
    expect(() => registry.register({ slot: "test.parent" }, () => null)).toThrow(
      "Plugin slot is not declared: test.parent"
    )

    const disposeParentDecl = registry.declare({ name: "test.parent", kind: "single" })

    // Register parent with children -> declares child slots atomically
    const disposeParent = registry.register(
      {
        id: "main-parent",
        slot: "test.parent",
        priority: 10,
        children: {
          "test.child.list": { kind: "list" },
          "test.child.keyed": { kind: "keyed" },
        },
      },
      () => null
    )

    expect(registry.getSnapshot().declarations.map((d) => d.name)).toEqual([
      "root",
      "test.parent",
      "test.child.list",
      "test.child.keyed",
    ])

    // Ambiguous priority on single slot throws loud
    expect(() =>
      registry.register({ id: "conflict", slot: "test.parent", priority: 10 }, () => null)
    ).toThrow("ambiguous priority")

    // Failing child declaration (already declared) throws loud and leaves zero partial state
    expect(() =>
      registry.register(
        {
          id: "backup-parent",
          slot: "test.parent",
          priority: 50,
          children: {
            "test.child.list": { kind: "list" },
          },
        },
        () => null
      )
    ).toThrow("Plugin slot already declared: test.child.list")
    expect(registry.getSnapshot().contributions.map((c) => c.id)).toEqual(["main-parent"])

    // Keyed slot requires key; non-keyed slot forbids key
    expect(() => registry.register({ slot: "test.child.keyed" } as never, () => null)).toThrow(
      "requires a key"
    )
    expect(() => registry.register({ slot: "test.child.list", key: "bad" }, () => null)).toThrow(
      "Only keyed plugin slot contributions may declare a key"
    )

    registry.register({ id: "b", slot: "test.child.list", order: 20 }, () => "B")
    registry.register({ id: "a", slot: "test.child.list", order: 10 }, () => "A")
    registry.register({ id: "k1", slot: "test.child.keyed", key: "tab1" }, () => "K1")

    expect(registry.select("test.child.list").map((c) => c.id)).toEqual(["a", "b"])
    expect(registry.select("test.child.keyed", "tab1").map((c) => c.id)).toEqual(["k1"])
    expect(registry.select("test.child.keyed", "missing")).toEqual([])

    // Disposing parent contribution tears down its child declarations AND clears contributions targeting them!
    disposeParent()
    expect(registry.getSnapshot().declarations.map((d) => d.name)).toEqual(["root", "test.parent"])
    expect(registry.getSnapshot().contributions).toEqual([])

    disposeParentDecl()
    runtime.dispose()
  })

  it("supports slots.inject deferred waiting, unwinding on slot disposal, re-running on redeclaration, and permanent fiber disposal", () => {
    const registry = new PluginSlotRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", registry)

    const lifecycleLog: string[] = []

    const consumer = definePlugin({
      manifest: {
        id: "example.consumer",
        name: "Consumer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("test.deferred", (scopedCtx) => {
          lifecycleLog.push("mount")
          scopedCtx.slots.register({ id: "injected-item", slot: "test.deferred" }, () => "Hi")
          return () => {
            lifecycleLog.push("unmount")
          }
        })
      },
    })

    runtime.register(consumer, "builtin")
    runtime.start(consumer.manifest.id)

    // Slot is not yet declared -> callback waits
    expect(lifecycleLog).toEqual([])
    expect(registry.getSnapshot().contributions).toEqual([])

    // 1st declaration -> callback runs immediately
    const disposeDecl1 = registry.declare({ name: "test.deferred", kind: "list" })
    expect(lifecycleLog).toEqual(["mount"])
    expect(registry.select("test.deferred").map((c) => c.id)).toEqual(["injected-item"])

    // Disposing declaration unwinds returned disposer & clears contributions
    disposeDecl1()
    expect(lifecycleLog).toEqual(["mount", "unmount"])
    expect(registry.getSnapshot().contributions).toEqual([])

    // Redeclaring slot -> callback re-runs cleanly!
    const disposeDecl2 = registry.declare({ name: "test.deferred", kind: "list" })
    expect(lifecycleLog).toEqual(["mount", "unmount", "mount"])
    expect(registry.select("test.deferred").map((c) => c.id)).toEqual(["injected-item"])

    // Stopping consumer fiber permanently unwinds and never re-runs on 3rd declaration
    runtime.stop(consumer.manifest.id)
    expect(lifecycleLog).toEqual(["mount", "unmount", "mount", "unmount"])
    expect(registry.select("test.deferred")).toEqual([])

    disposeDecl2()
    const disposeDecl3 = registry.declare({ name: "test.deferred", kind: "list" })
    expect(lifecycleLog).toEqual(["mount", "unmount", "mount", "unmount"])
    expect(registry.select("test.deferred")).toEqual([])

    disposeDecl3()
    runtime.dispose()
  })

  it("instantiates StoreDefinition once with registrant storage and disposes on registration unwind", async () => {
    const saved = new Map<string, string>()
    const storageService: ScopedPluginService<PluginStorageService> = {
      [PLUGIN_SERVICE_SCOPE](_ctx, manifest) {
        const kv = {
          getItem: async (k: string) => saved.get(`${manifest.id}:${k}`) ?? null,
          setItem: async (k: string, v: string) => {
            saved.set(`${manifest.id}:${k}`, v)
          },
          removeItem: async (k: string) => {
            saved.delete(`${manifest.id}:${k}`)
          },
        }
        return { local: kv, secure: kv }
      },
    }

    const registry = new PluginSlotRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("storage", storageService)
    runtime.context.set("slots", registry)

    const counterStore = defineStore({
      init: () => ({ value: 1 }),
      persist: { key: "counter" },
      actions: {
        bump(ctx) {
          ctx.set((s) => ({ value: s.value + 1 }))
        },
      },
    })

    const plugin = definePlugin({
      manifest: {
        id: "example.store-slot",
        name: "Store Slot",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.register({ id: "root-view", slot: "root", store: counterStore }, () => null)
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    const entry = registry.select("root")[0]!
    const instance = entry.store as ReturnType<typeof counterStore.create>
    instance.actions.bump()
    expect(instance.source.getSnapshot()).toEqual({ value: 2 })
    await vi.waitFor(() => expect(saved.get("example.store-slot:counter")).toContain("2"))

    runtime.stop(plugin.manifest.id)
    instance.actions.bump()
    // Disposed store ignores further mutations
    expect(instance.source.getSnapshot()).toEqual({ value: 2 })
    runtime.dispose()
  })
})

describe("UIRenderer: ContributionOutlet 4-share synthesis, slot authorization, chain composition & ErrorBoundary", () => {
  it("synthesizes all 4 shares reactively, composes chain slots right-to-left, and enforces child authorization", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const slots = new PluginSlotRegistry()
    const i18n = new PluginI18nRegistry({ defaultLocale: "zh" })
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)

    const dict = defineDictionary({
      zh: { header: "标题:{heading}" },
      en: { header: "Title:{heading}" },
    })

    const panelStore = defineStore({
      init: () => ({ count: 10 }),
      actions: {
        increment(ctx) {
          ctx.set((s) => ({ count: s.count + 5 }))
        },
      },
    })

    const badgeSource = createObservableSource(3)
    const seenHookRefs: Array<unknown> = []
    let triggerStoreIncrement!: () => void
    let tryUnauthorizedSlot!: () => void
    let tryWrongMethodOnChain!: () => void
    let rawHooksExposed = false

    slots.declare({ name: "test.parent", kind: "single" })

    const hostPlugin = definePlugin({
      manifest: {
        id: "example.host-card",
        name: "Host Card",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["slots", "i18n"],
      apply(ctx) {
        ctx.i18n.register({
          zh: { fallbackKey: "来自注册表" },
          en: { fallbackKey: "FromRegistry" },
        })

        ctx.slots.register(
          {
            id: "card",
            slot: "test.parent",
            dictionary: dict,
            children: {
              "test.child.list": { kind: "list" },
              "test.child.chain": { kind: "chain" },
              "test.empty.chain": { kind: "chain" },
            },
            store: panelStore,
            inject: () => ({
              staticTag: "V3",
              hooks: {
                badgeCount: badgeSource,
              },
            }),
          },
          (props) => {
            rawHooksExposed = "hooks" in (props as Record<string, unknown>)
            seenHookRefs.push(props.useBadgeCount)
            triggerStoreIncrement = props.actions.increment
            tryUnauthorizedSlot = () => {
              ;(props.renderSlot as (name: string) => unknown)("root")
            }
            tryWrongMethodOnChain = () => {
              ;(props.renderSlot as (name: string) => unknown)("test.child.chain")
            }

            const count = props.useStore((s) => s.count)
            const badges = props.useBadgeCount((n) => n * 2)
            const fallbackTranslated = (props.t as (k: string) => string)("fallbackKey")

            return (
              <div>
                <span>
                  {props.t("header", { heading: props.heading })}|{props.locale}|
                  {fallbackTranslated}|{props.staticTag}|store:{count}|badge:{badges}
                </span>
                <section>{props.renderSlot("test.child.list", { prefix: "item" })}</section>
                <article>
                  {props.renderSlotChain(
                    "test.child.chain",
                    { tag: "wrap" },
                    <em>{props.renderSlotChain("test.empty.chain", "CORE")}</em>
                  )}
                </article>
              </div>
            )
          }
        )

        // List children in ascending order
        ctx.slots.register({ id: "second", slot: "test.child.list", order: 20 }, (p) => (
          <b>{p.prefix}-2</b>
        ))
        ctx.slots.register({ id: "first", slot: "test.child.list", order: 10 }, (p) => (
          <b>{p.prefix}-1</b>
        ))

        // Chain children: order 10 (outer) wraps order 20 (inner) right-to-left around fallback!
        ctx.slots.register({ id: "inner-chain", slot: "test.child.chain", order: 20 }, (p) => (
          <span>
            [inner:{p.tag}]{p.children}[/inner]
          </span>
        ))
        ctx.slots.register({ id: "outer-chain", slot: "test.child.chain", order: 10 }, (p) => (
          <span>
            [outer:{p.tag}]{p.children}[/outer]
          </span>
        ))
      },
    })

    runtime.register(hostPlugin, "builtin")
    runtime.start(hostPlugin.manifest.id)

    const entry = slots.select("test.parent")[0]!
    await dom.render(
      <ContributionOutlet entry={entry} owner={{ heading: "课表" }} slots={slots} i18n={i18n} />
    )

    expect(rawHooksExposed).toBe(false)
    expect(dom.container.textContent).toContain("标题:课表|zh|来自注册表|V3|store:10|badge:6")
    expect(dom.container.textContent).toContain("item-1item-2")
    expect(dom.container.textContent).toContain("[outer:wrap][inner:wrap]CORE[/inner][/outer]")

    // Unauthorized slot and wrong render method throw loud!
    expect(() => tryUnauthorizedSlot()).toThrow("not authorized to render slot")
    expect(() => tryWrongMethodOnChain()).toThrow("must use renderSlotChain")

    // Mutate store, observable hook, and i18n locale -> live reactive DOM updates!
    await act(async () => {
      triggerStoreIncrement()
      badgeSource.set(7)
      i18n.setLocale("en")
    })

    expect(dom.container.textContent).toContain("Title:课表|en|FromRegistry|V3|store:15|badge:14")
    // Hook function reference is cached per ObservableSource across renders
    expect(seenHookRefs.length).toBeGreaterThanOrEqual(2)
    expect(seenHookRefs[0]).toBe(seenHookRefs[1])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })

  it("renders pages, settings categories, and widget-like contributions uniformly and isolates crashes via ErrorBoundary", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const ui = new PluginUIRegistry()
    const settings = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("ui", ui)
    runtime.context.set("settings", settings)

    const plugin = definePlugin({
      manifest: {
        id: "example.uniform",
        name: "Uniform",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui", "settings"],
      apply(ctx) {
        ctx.ui.registerPage({ id: "p1" }, (props) => <div>page:{props.locale}</div>)
        ctx.settings.registerCategory({ id: "c1", icon: () => null }, (props) => (
          <div>cat:{props.locale}</div>
        ))
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    const pageEntry = ui.findPage("example.uniform", "p1")!
    const catEntry = settings.getSnapshot()[0]!
    const overviewWidgetLike = {
      id: "w1",
      pluginId: "example.uniform",
      component: ((props: { locale: string }) => <div>widget:{props.locale}</div>) as never,
    }

    const staticMarkup = renderToStaticMarkup(
      <div>
        <ContributionOutlet entry={pageEntry} />
        <ContributionOutlet entry={catEntry} />
        <ContributionOutlet entry={overviewWidgetLike} />
      </div>
    )
    expect(staticMarkup).toBe("<div><div>page:zh</div><div>cat:zh</div><div>widget:zh</div></div>")

    // Verify per-entry ErrorBoundary catches crashing contribution without unmounting siblings
    const onError = vi.fn()
    const crashingEntry = {
      id: "boom",
      pluginId: "example.crash",
      component: (() => {
        throw new Error("contribution boom")
      }) as never,
    }

    const prevConsoleError = console.error
    console.error = () => {}
    try {
      await dom.render(
        <div>
          <span>sibling-alive</span>
          <ContributionOutlet
            entry={crashingEntry}
            errorFallback={<span>fallback-shown</span>}
            onError={onError}
          />
        </div>
      )
    } finally {
      console.error = prevConsoleError
    }

    expect(onError).toHaveBeenCalledOnce()
    expect(dom.container.textContent).toBe("sibling-alivefallback-shown")
    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })

  it("remounts dedicated target fibers cleanly when ContributionOutlet switches entries with different hook counts without an outer key", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const ui = new PluginUIRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("ui", ui)

    const lifecycleEvents: string[] = []
    let mutatePageALocalState!: (next: string) => void

    const pageBStore = defineStore({
      init: () => ({ step: 42 }),
      actions: {},
    })

    const plugin = definePlugin({
      manifest: {
        id: "example.switch",
        name: "Switch",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        // pageA uses 2 useState hooks + 1 useEffect hook
        ctx.ui.registerPage({ id: "pageA" }, (props) => {
          const [draft, setDraft] = useState("initial-A")
          const [extra] = useState(7)
          mutatePageALocalState = setDraft
          useEffect(() => {
            lifecycleEvents.push("mount:A")
            return () => {
              lifecycleEvents.push("unmount:A")
            }
          }, [])
          return (
            <div>
              A:{draft}:{extra}:{props.locale}
            </div>
          )
        })

        // pageB uses 0 useState hooks + 1 store hook + 1 useEffect hook (different hook signature!)
        ctx.ui.registerPage({ id: "pageB", store: pageBStore }, (props) => {
          const step = props.useStore((s) => s.step)
          useEffect(() => {
            lifecycleEvents.push("mount:B")
            return () => {
              lifecycleEvents.push("unmount:B")
            }
          }, [])
          return <div>B:{step}</div>
        })
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    const pageA = ui.findPage("example.switch", "pageA")!
    const pageB = ui.findPage("example.switch", "pageB")!

    // Render pageA via unkeyed ContributionOutlet and mutate its local state
    await dom.render(<ContributionOutlet entry={pageA} />)
    expect(dom.container.textContent).toBe("A:initial-A:7:zh")
    expect(lifecycleEvents).toEqual(["mount:A"])

    await act(async () => {
      mutatePageALocalState("dirty-A")
    })
    expect(dom.container.textContent).toBe("A:dirty-A:7:zh")

    // Switch same unkeyed ContributionOutlet to pageB -> unmounts A cleanly and mounts B with zero hook mismatch!
    await dom.render(<ContributionOutlet entry={pageB} />)
    expect(dom.container.textContent).toBe("B:42")
    expect(lifecycleEvents).toEqual(["mount:A", "unmount:A", "mount:B"])

    // Switch back to pageA -> fresh remount resets local state back to "initial-A"
    await dom.render(<ContributionOutlet entry={pageA} />)
    expect(dom.container.textContent).toBe("A:initial-A:7:zh")
    expect(lifecycleEvents).toEqual(["mount:A", "unmount:A", "mount:B", "unmount:B", "mount:A"])

    activeUnmount = undefined
    await dom.unmount()
    expect(lifecycleEvents).toEqual([
      "mount:A",
      "unmount:A",
      "mount:B",
      "unmount:B",
      "mount:A",
      "unmount:A",
    ])
    runtime.dispose()
  })
})

describe("OrahakoApp root component (root slot, shell selection/fallback, KernelRecovery & theme CSS)", () => {
  it("selects shells, falls back to default shell when selected shell crashes, applies theme CSS, and honors 'root' slot override", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    let shouldCrashAltShell = false
    let selectShellFn: ((id?: string) => void) | undefined

    const defaultShellPlugin = definePlugin({
      manifest: {
        id: "orahako.shell.default",
        name: "Default Shell",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerShell({ id: "main", name: "Default" }, (props) => {
          selectShellFn = props.selectShell
          return <div data-shell="default">DefaultShell:{props.children}</div>
        })
        ctx.ui.registerTheme({
          id: "sakura",
          name: "Sakura",
          css: ":root { --primary: hotpink; }",
        })
      },
    })

    const altShellPlugin = definePlugin({
      manifest: {
        id: "orahako.shell.alt",
        name: "Alt Shell",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerShell({ id: "pro", name: "Pro" }, (props) => {
          if (shouldCrashAltShell) {
            throw new Error("Alt shell exploded")
          }
          selectShellFn = props.selectShell
          return <div data-shell="alt">AltShell:{props.children}</div>
        })
      },
    })

    const rootOverridePlugin = definePlugin({
      manifest: {
        id: "orahako.root.override",
        name: "Root Override",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.register({ id: "takeover", slot: "root" }, () => <div>RootSlotTakeover</div>)
      },
    })

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "test-1",
      composition: {
        id: "test.app",
        version: 1,
        defaults: {
          shell: "orahako.shell.default:main",
        },
        plugins: [
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
          { id: "orahako.runtime.i18n", protected: true },
          { id: "orahako.shell.default", protected: true },
          { id: "orahako.shell.alt" },
          { id: "orahako.root.override", disabled: true },
        ],
      },
      plugins: [
        slotRegistryPlugin,
        uiRegistryPlugin,
        i18nRegistryPlugin,
        defaultShellPlugin,
        altShellPlugin,
        rootOverridePlugin,
      ],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()

    await dom.render(<OrahakoApp host={host}>PAGE_BODY</OrahakoApp>)

    // Default shell renders, but no theme is injected until the host preference selects one.
    expect(dom.container.textContent).toContain("DefaultShell:PAGE_BODY")
    expect(dom.container.toHtml()).not.toContain("data-plugin-theme")

    // The host preference is the single theme source; a registered non-empty theme is not auto-applied.
    await act(async () => {
      host.preferences.setActiveTheme("orahako.shell.default:sakura")
    })
    expect(dom.container.toHtml()).toContain(
      '<style data-plugin-theme="orahako.shell.default:sakura">:root { --primary: hotpink; }</style>'
    )

    // Clearing the preference removes the theme again.
    await act(async () => {
      host.preferences.setActiveTheme("")
    })
    expect(dom.container.toHtml()).not.toContain("data-plugin-theme")

    // OrahakoApp subscribes to preferences.state, so an external shell change applies immediately.
    await act(async () => {
      host.preferences.setActiveShell("orahako.shell.alt:pro")
    })
    expect(dom.container.textContent).toContain("AltShell:PAGE_BODY")

    // Switch back to the default shell via the shell-provided callback.
    await act(async () => {
      selectShellFn?.()
    })
    expect(dom.container.textContent).toContain("DefaultShell:PAGE_BODY")

    // Switch to alt shell via selectShell
    await act(async () => {
      selectShellFn?.("orahako.shell.alt:pro")
    })
    expect(host.preferences.getActiveShell()).toBe("orahako.shell.alt:pro")
    expect(dom.container.textContent).toContain("AltShell:PAGE_BODY")

    // Force alt shell to crash on next render -> ShellErrorBoundary automatically falls back to default shell and resets preference!
    shouldCrashAltShell = true
    const prevErr = console.error
    console.error = () => {}
    try {
      await dom.render(<OrahakoApp host={host}>CRASH_TEST</OrahakoApp>)
    } finally {
      console.error = prevErr
    }
    expect(dom.container.textContent).toContain("DefaultShell:CRASH_TEST")
    expect(host.preferences.getActiveShell()).toBeUndefined()

    // Enabling 'root' slot contribution takes precedence over shells
    await act(async () => {
      await host.enable("orahako.root.override")
    })
    expect(dom.container.textContent).toContain("RootSlotTakeover")

    activeUnmount = undefined
    await dom.unmount()
    host.dispose()
  })

  it("renders KernelRecovery when no shells or root contributions are registered", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "test-empty",
      composition: {
        id: "test.empty",
        version: 1,
        defaults: {},
        plugins: [
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
        ],
      },
      plugins: [slotRegistryPlugin, uiRegistryPlugin],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()

    await dom.render(<OrahakoApp host={host} />)
    expect(dom.container.toHtml()).toContain("data-kernel-recovery")
    expect(dom.container.textContent).toContain("应用界面未能加载")

    activeUnmount = undefined
    await dom.unmount()
    host.dispose()
  })

  it("automatically resolves active pages, canonicalizes ?route=, redirects root landing, and localizes empty/crash states when children is omitted", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const shellPlugin = definePlugin({
      manifest: {
        id: "orahako.shell.test",
        name: "Test Shell",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerShell({ id: "default", name: "Default" }, (props) => (
          <div data-shell="host">{props.children}</div>
        ))
      },
    })

    const pagesDict = defineDictionary({
      zh: { home: "首页内容", profile: "个人资料:{tab}" },
      en: { home: "HomeContent", profile: "ProfileView:{tab}" },
    })

    const pagesPlugin = definePlugin({
      manifest: {
        id: "example.pages",
        name: "Pages",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui", "router"],
      apply(ctx) {
        ctx.ui.registerPage(
          {
            id: "home",
            route: "home",
            primary: true,
            requiresProvider: false,
            dictionary: pagesDict,
          },
          (props) => <div>{props.t("home")}</div>
        )
        ctx.ui.registerPage(
          {
            id: "profile",
            route: "profile",
            requiresProvider: false,
            dictionary: pagesDict,
            inject: () => ({
              hooks: {
                location: ctx.router.current,
              },
            }),
          },
          (props) => {
            const loc = props.useLocation()
            return <div>{props.t("profile", { tab: loc.params.tab ?? "none" })}</div>
          }
        )
        ctx.ui.registerPage(
          {
            id: "crash",
            route: "crash",
            requiresProvider: false,
          },
          () => {
            throw new Error("page exploded")
          }
        )
      },
    })

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "test-auto-page",
      composition: {
        id: "test.auto-page",
        version: 1,
        defaults: {
          shell: "orahako.shell.test:default",
          landing: "home",
        },
        plugins: [
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
          { id: "orahako.runtime.i18n", protected: true },
          { id: "orahako.runtime.router", protected: true, config: { initialHref: "/" } },
          { id: "orahako.runtime.navigation", protected: true },
          { id: "orahako.shell.test", protected: true },
          { id: "example.pages" },
        ],
      },
      plugins: [
        slotRegistryPlugin,
        uiRegistryPlugin,
        i18nRegistryPlugin,
        routerRuntimePlugin,
        navigationRuntimePlugin,
        shellPlugin,
        pagesPlugin,
      ],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()
    const router = host.runtime.context.get("router") as PluginRouter

    // 1. Omitted children at `/` redirects to `navigation.landing("home")` and renders `home` page!
    await dom.render(<OrahakoApp host={host} />)
    expect(dom.container.textContent).toContain("首页内容")
    expect(router.current.getSnapshot().href).toBe("/?plugin=example.pages&page=home")

    // 2. Navigating to semantic `?route=profile&tab=security` canonicalizes via router.replace preserving params!
    await act(async () => {
      router.push("/?route=profile&tab=security")
    })
    expect(dom.container.textContent).toContain("个人资料:security")
    expect(router.current.getSnapshot().href).toBe(
      "/?plugin=example.pages&page=profile&tab=security"
    )

    // 3. Navigating to missing page shows localized unavailable empty state (zh -> en)
    await act(async () => {
      router.push("/?plugin=missing.plugin&page=nope")
    })
    expect(dom.container.textContent).toContain("插件页面不可用")
    await act(async () => {
      host.i18n?.setLocale("en")
    })
    expect(dom.container.textContent).toContain("Plugin page unavailable")

    // 4. Crashing page is caught by ContributionOutlet errorFallback without crashing the shell!
    const prevErr = console.error
    console.error = () => {}
    try {
      await act(async () => {
        router.push("/?route=crash")
      })
    } finally {
      console.error = prevErr
    }
    expect(dom.container.toHtml()).toContain('data-shell="host"')
    expect(dom.container.textContent).toContain("Plugin page failed")

    activeUnmount = undefined
    await dom.unmount()
    host.dispose()
  })
})
