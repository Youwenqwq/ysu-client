import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: toastMocks,
}))

import { PluginRuntime } from "@orahako/kernel"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { routerRuntimePlugin } from "@orahako/runtime-router"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  aes128EcbEncrypt,
  bytesToBase64,
  createObservableSource,
  type HttpRequest,
  type HttpResponse,
  type PluginHttpService,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as meterEntry from "../src"
import { METER_PLUGIN_ID, meterPlugin } from "../src"
import { meterRoomStore } from "../src/store"

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
  readonly style: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      ;(this as Record<string, unknown>)[name] = value
    },
    removeProperty(name: string) {
      delete (this as Record<string, unknown>)[name]
    },
  }
  readonly attributes = new Map<string, string>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
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
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniDomNode, before: MiniDomNode | null): MiniDomNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    const index = this.childNodes.indexOf(before)
    child.parentNode = this
    if (index >= 0) this.childNodes.splice(index, 0, child)
    else this.childNodes.push(child)
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

  findAll(predicate: (node: MiniDomNode) => boolean): MiniDomNode[] {
    const found: MiniDomNode[] = []
    if (predicate(this)) found.push(this)
    for (const child of this.childNodes) {
      found.push(...child.findAll(predicate))
    }
    return found
  }
}

function mountMiniDom() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { pathname: "/", search: "", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
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
    async render(node: ReactNode) {
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

beforeEach(() => {
  toastMocks.error.mockReset()
})

function createMemoryStorage(): {
  readonly map: Map<string, string>
  readonly backend: PluginKeyValueStorage
} {
  const map = new Map<string, string>()
  return {
    map,
    backend: {
      getItem: async (key) => map.get(key) ?? null,
      setItem: async (key, value) => {
        map.set(key, value)
      },
      removeItem: async (key) => {
        map.delete(key)
      },
    },
  }
}

function makeEncryptedHttp(
  rooms: Readonly<Record<string, { roomName: string; remaining: number }>>
): PluginHttpService {
  const resTs = "1760000000001"
  const resRs = "ABCDEFGHIJ"
  const key = new TextEncoder().encode(resTs.slice(0, 6) + resRs)
  const encode = (envelope: unknown): HttpResponse => ({
    status: 200,
    headers: {},
    url: "",
    text: async () =>
      JSON.stringify({
        randomStr: resRs,
        timestamp: resTs,
        encryptData: bytesToBase64(
          aes128EcbEncrypt(key, new TextEncoder().encode(JSON.stringify(envelope)))
        ),
      }),
    arrayBuffer: async () => new ArrayBuffer(0),
  })

  const emptyActivity = createObservableSource({
    active: [],
    history: [],
    session: null,
    revision: 0,
  })

  return {
    async send(req: HttpRequest): Promise<HttpResponse> {
      const form = new URLSearchParams(String(req.body))
      const method = form.get("method")
      // Match room based on account in rooms map
      if (method === "getbindroom") {
        // Find which room matches by inspecting rooms entries (first matching or single entry)
        const entries = Object.entries(rooms)
        const picked = entries[0]
        if (!picked) {
          return encode({ code_: 0, body: JSON.stringify({ result: "-1" }) })
        }
        return encode({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            roomfullname: picked[1].roomName,
            roomverify: `rv-${picked[0]}`,
            account_num: picked[0],
          }),
        })
      }
      const first = Object.values(rooms)[0]!
      if (method === "h5_getstuindexpage") {
        return encode({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            roomfullname: first.roomName,
            roomnum: "526",
            modlist: [
              {
                devicename: "空调电表",
                odd: String(first.remaining),
                todayuse: "2.5",
                price: "0.52",
                monthuselist: [{ yearmonth: "2026.11", monthuse: "35.0" }],
                linestatus: [{ desc: "第一路:一般送电" }],
              },
            ],
          }),
        })
      }
      if (method === "gettimeusedetail") {
        return encode({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            dayuselist: [
              { date: "2026-11-17", use: "2.0" },
              { date: "2026-11-18", use: "3.0" },
            ],
          }),
        })
      }
      return encode({
        code_: 0,
        body: JSON.stringify({
          result: "0",
          list: [
            {
              dayrechargelist: [
                { daytime: "2026-11-10 18:30", name: "自助购电", sumbuy: "50", sumbuyfare: "26" },
              ],
            },
          ],
        }),
      })
    },
    activity: {
      state: emptyActivity,
      getSnapshot: emptyActivity.getSnapshot,
      subscribe: emptyActivity.subscribe,
      beginRequest: () => () => {},
      registerLabeler: () => () => {},
      registerClassifier: () => () => {},
    },
  }
}

describe("@orahako/plugin-meter", () => {
  it("enforces strict export discipline and providerIndependent manifest", () => {
    expect(Object.keys(meterEntry).sort()).toEqual(["METER_PLUGIN_ID", "default", "meterPlugin"])
    expect(meterEntry.default).toBe(meterPlugin)
    expect(meterPlugin.manifest.id).toBe("orahako.meter")
    expect(meterPlugin.manifest.providerIndependent).toBe(true)
    expect(meterPlugin.manifest.inject).toEqual([
      "ui",
      "slots",
      "router",
      "i18n",
      "storage",
      "http",
    ])
  })

  it("manages room history in meterRoomStore cleanly", () => {
    const store = meterRoomStore.create()
    store.actions.saveRoom({
      account: "2024001",
      roomFullName: "西区526",
      roomverify: "rv-1",
      accountNum: "1001",
      updatedAt: 100,
    })
    store.actions.saveRoom({
      account: "2024002",
      roomFullName: "东区302",
      roomverify: "rv-2",
      accountNum: "1002",
      updatedAt: 200,
    })
    expect(store.source.getSnapshot().selectedAccount).toBe("2024002")
    expect(store.source.getSnapshot().history.map((h) => h.account)).toEqual(["2024002", "2024001"])

    store.actions.removeRoom("2024002")
    expect(store.source.getSnapshot().selectedAccount).toBe("2024001")
    expect(store.source.getSnapshot().history.map((h) => h.account)).toEqual(["2024001"])
    store.dispose()
  })

  it("renders a route-scoped mobile refresh and persists room history in a non-academic runtime", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const localMem = createMemoryStorage()
    const secureMem = createMemoryStorage()
    const runtime = new PluginRuntime()

    runtime.context.set(
      "storage",
      new NamespacedStorageService({
        local: localMem.backend,
        secure: secureMem.backend,
      })
    )
    const http = makeEncryptedHttp({
      "202411040369": { roomName: "西校区_四组团B座_526房间", remaining: 68.5 },
    })
    const send = vi.spyOn(http, "send")
    runtime.context.set("http", http)

    for (const plugin of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      meterPlugin,
    ]) {
      runtime.register(plugin, "builtin")
      runtime.start(plugin.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const router = runtime.context.get("router")!

    slots.declare({ name: "shell.header.actions", kind: "list" })
    const [headerActions] = slots.select("shell.header.actions")
    expect(headerActions?.pluginId).toBe(METER_PLUGIN_ID)

    const meterPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === METER_PLUGIN_ID && p.id === "index")!
    expect(meterPage.route).toBe("meter")
    expect(meterPage.requiresProvider).toBe(false)

    const meterNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === METER_PLUGIN_ID && n.id === "meter")!
    expect(meterNav).toMatchObject({
      id: "meter",
      page: "index",
      group: "fees",
    })

    await dom.render(
      <>
        <header>
          <ContributionOutlet entry={headerActions!} slots={slots} i18n={i18n} />
        </header>
        <main>
          <ContributionOutlet entry={meterPage} slots={slots} i18n={i18n} />
        </main>
      </>
    )
    const header = dom.container.findAll((node) => node.tagName === "HEADER")[0]!
    const body = dom.container.findAll((node) => node.tagName === "MAIN")[0]!
    const isRefresh = (node: MiniDomNode) => node.attributes.get("aria-label") === "刷新"
    expect(header.findAll(isRefresh)).toEqual([])
    await act(async () => router.push({ pluginId: METER_PLUGIN_ID }))
    expect(header.findAll(isRefresh)).toHaveLength(1)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("请输入学号查询宿舍空调电表")
    })

    // Query account via page's injected queryAccount callback
    const injected: unknown = meterPage.inject?.(runtime.context)
    const queryAccount: unknown =
      typeof injected === "object" && injected !== null
        ? Reflect.get(injected, "queryAccount")
        : null
    expect(typeof queryAccount).toBe("function")
    await act(async () => {
      if (typeof queryAccount === "function") {
        await queryAccount("202411040369")
      }
    })

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("西校区_四组团B座_526房间")
      expect(dom.container.textContent).toContain("68.5")
      expect(dom.container.textContent).toContain("第一路:一般送电")
      expect(dom.container.textContent).toContain("自助购电")
      expect(dom.container.textContent).toContain("常用房间")
    })

    const headerButtons = header.findAll(isRefresh)
    expect(headerButtons).toHaveLength(1)
    const [headerRefresh] = headerButtons
    expect(headerRefresh?.attributes.get("data-variant")).toBe("ghost")
    expect(headerRefresh?.attributes.get("data-size")).toBe("icon-sm")
    expect(headerRefresh?.attributes.get("class")?.split(" ")).toContain("md:hidden")
    const bodyButtons = body.findAll(isRefresh)
    expect(bodyButtons).toHaveLength(1)
    const [bodyRefresh] = bodyButtons
    expect(bodyRefresh?.attributes.get("class")?.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "md:inline-flex"])
    )

    const refreshPropsKey = Object.keys(headerRefresh!).find((key) =>
      key.startsWith("__reactProps$")
    )!
    const refreshClick: unknown = Reflect.get(
      Reflect.get(headerRefresh!, refreshPropsKey),
      "onClick"
    )
    expect(typeof refreshClick).toBe("function")
    send.mockClear()
    await act(async () => {
      if (typeof refreshClick === "function") refreshClick()
    })
    expect(
      send.mock.calls.map(([request]) => new URLSearchParams(String(request.body)).get("method"))
    ).toContain("getbindroom")

    await act(async () => router.push({ route: "meter" }))
    expect(header.findAll(isRefresh)).toHaveLength(1)
    await act(async () => router.push({ route: "ecard" }))
    expect(header.findAll(isRefresh)).toEqual([])

    // Verify room history persisted into namespaced local storage
    await vi.waitFor(() => {
      expect(localMem.map.get("orahako-plugin:orahako.meter:meter-rooms")).toContain(
        "西校区_四组团B座_526房间"
      )
    })

    // Bilingual English render
    await act(async () => {
      i18n.setLocale("en")
    })
    expect(dom.container.textContent).toContain("kWh")
    expect(dom.container.textContent).toContain("Recharge History")

    await act(async () => {
      runtime.stop(METER_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((p) => p.pluginId === METER_PLUGIN_ID)).toBe(false)
    expect(slots.select("shell.header.actions")).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
