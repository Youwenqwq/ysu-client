import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginHost } from "@orahako/kernel"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type CompositionSource,
} from "@orahako/sdk"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { nativeRuntimePlugin } from "@orahako/runtime-native"
import { navigationRuntimePlugin, PluginRouter, routerRuntimePlugin } from "@orahako/runtime-router"
import { OrahakoApp, slotRegistryPlugin } from "@orahako/runtime-slots"
import { storageRuntimePlugin } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  AvatarMediaController,
  DEBUG_TAP_THRESHOLD,
  manifest,
  PROFILE_PLUGIN_ID,
  profileStore,
  uiProfilePlugin,
} from "../src"

class MiniNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniNode[] = []
  parentNode: MiniNode | null = null
  ownerDocument: MiniNode | null = null
  defaultView: unknown = undefined
  nodeValue?: string
  readonly style: Record<string, unknown> = {
    setProperty: vi.fn(),
    removeProperty: vi.fn(),
  }
  readonly classList = {
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    contains: () => false,
  }
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
  }

  appendChild(child: MiniNode): MiniNode {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniNode, before: MiniNode | null): MiniNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    const idx = this.childNodes.indexOf(before)
    child.parentNode = this
    if (idx >= 0) this.childNodes.splice(idx, 0, child)
    else this.childNodes.push(child)
    return child
  }

  removeChild(child: MiniNode): MiniNode {
    const idx = this.childNodes.indexOf(child)
    if (idx >= 0) {
      this.childNodes.splice(idx, 1)
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

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn)
  }

  click(): void {
    dispatchBubbleClick(this)
  }

  findByAttr(attrName: string): MiniNode | undefined {
    if (this.attributes.has(attrName)) return this
    for (const child of this.childNodes) {
      const found = child.findByAttr(attrName)
      if (found) return found
    }
    return undefined
  }

  dispatchEventListeners(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) {
      fn(event)
    }
  }

  set textContent(val: string) {
    this.childNodes.length = 0
    this.rawText = String(val)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((c) => c.textContent).join("")
  }
}

function dispatchBubbleClick(startNode: MiniNode): void {
  const event: Record<string, unknown> = {
    type: "click",
    button: 0,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    target: startNode,
    srcElement: startNode,
    currentTarget: startNode,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopPropagation() {},
  }
  event.nativeEvent = event
  let cursor: MiniNode | null = startNode
  while (cursor) {
    event.currentTarget = cursor
    cursor.dispatchEventListeners("click", event)
    cursor = cursor.parentNode
  }
}

function mountMiniDom() {
  const prevWin = globalThis.window
  const prevDoc = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const doc = new MiniNode(9, "#document")
  const docElement = new MiniNode(1, "HTML")
  const body = new MiniNode(1, "BODY")
  doc.appendChild(docElement)
  docElement.appendChild(body)

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    screen: { width: 1280, height: 800 },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  doc.defaultView = fakeWin

  const docObj = Object.assign(doc, {
    documentElement: docElement,
    body,
    cookie: "",
    activeElement: null,
    createElement(tag: string) {
      const el = new MiniNode(1, tag.toUpperCase())
      el.ownerDocument = docObj
      return el
    },
    createElementNS(_ns: string, tag: string) {
      return docObj.createElement(tag)
    },
    createTextNode(text: string) {
      const node = new MiniNode(3, "#text")
      node.nodeValue = String(text)
      node.ownerDocument = docObj
      return node
    },
    createComment(text: string) {
      const node = new MiniNode(8, "#comment")
      node.nodeValue = String(text)
      node.ownerDocument = docObj
      return node
    },
  })

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docObj

  const container = docObj.createElement("div")
  body.appendChild(container)
  const root = createRoot(container as never)

  return {
    container,
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
      ;(globalThis as Record<string, unknown>).window = prevWin
      ;(globalThis as Record<string, unknown>).document = prevDoc
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

function DummyIcon() {
  return null
}

describe("@orahako/ui-profile", () => {
  it("validates API v1 manifest, avatar media controller, and profile store", async () => {
    const validated = validatePluginManifest(manifest)
    expect(validated.id).toBe(PROFILE_PLUGIN_ID)
    expect(validated.kind).toBe("feature")
    expect(validated.providerIndependent).toBe(true)
    expect(validated.required).toBe(true)
    expect(validated.provides).toEqual(["profile"])
    expect(validated.inject).toEqual([
      "ui",
      "slots",
      "router",
      "navigation",
      "i18n",
      "storage",
      "native",
    ])

    const store = profileStore.create()
    store.actions.setDisplayName("  Alice  ")
    expect(store.source.getSnapshot().displayName).toBe("Alice")
    store.dispose()

    const media = new AvatarMediaController({ isNative: () => false })
    const sampleDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const token = await media.save(sampleDataUrl)
    expect(token).toBe("avatar-image.jpg")
    expect(media.urlSource.getSnapshot()).toBeTruthy()

    await media.remove()
    expect(media.urlSource.getSnapshot()).toBeNull()
    media.dispose()
  })

  it("registers me/avatar/about/debug pages, slots, sidebar footer, and navigates to debug on 7-tap version trigger", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const testShell = definePlugin({
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
        ctx.ui.registerShell(
          {
            id: "default",
            name: "Shell",
            children: {
              "shell.sidebar.footer": { kind: "list" },
            },
          },
          (props) => (
            <div>
              <aside>{props.renderSlot("shell.sidebar.footer")}</aside>
              <main>{props.children}</main>
            </div>
          )
        )
      },
    })

    const extraPlugin = definePlugin({
      manifest: {
        id: "example.profile-ext",
        name: "Profile Ext",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui", "slots"],
      apply(ctx) {
        ctx.ui.registerPage({ id: "tool", requiresProvider: false }, () => <div>Tool</div>)
        ctx.ui.registerNavigation({
          id: "tool",
          title: "Campus Tool",
          page: "tool",
          icon: DummyIcon,
          group: "extras",
        })
        ctx.slots.inject("profile.accountActions", (sCtx) =>
          sCtx.slots.register({ id: "logout-btn", slot: "profile.accountActions" }, () => (
            <div>CUSTOM_ACCOUNT_ACTION</div>
          ))
        )
        ctx.slots.inject("about.extra", (sCtx) =>
          sCtx.slots.register({ id: "ota-row", slot: "about.extra" }, () => (
            <div>ABOUT_EXTRA_ROW</div>
          ))
        )
        ctx.slots.inject("debug.panels", (sCtx) =>
          sCtx.slots.register({ id: "custom-diag", slot: "debug.panels" }, () => (
            <div>CUSTOM_DEBUG_PANEL</div>
          ))
        )
      },
    })

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "b42",
      composition: {
        id: "test.profile",
        version: 1,
        defaults: { shell: "test.shell:default" },
        plugins: [
          { id: "orahako.runtime.storage", protected: true },
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
          { id: "orahako.runtime.i18n", protected: true },
          { id: "orahako.runtime.router", protected: true, config: { initialHref: "/" } },
          { id: "orahako.runtime.navigation", protected: true },
          { id: "orahako.runtime.native", protected: true },
          { id: "test.shell", protected: true },
          {
            id: PROFILE_PLUGIN_ID,
            protected: true,
            config: { appVersion: "0.16.0", appBuild: "b42" },
          },
          { id: "example.profile-ext" },
        ],
      },
      plugins: [
        storageRuntimePlugin,
        slotRegistryPlugin,
        uiRegistryPlugin,
        i18nRegistryPlugin,
        routerRuntimePlugin,
        navigationRuntimePlugin,
        nativeRuntimePlugin,
        testShell,
        uiProfilePlugin,
        extraPlugin,
      ],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()
    const router = host.runtime.context.get("router") as PluginRouter

    // 1. Root `/` resolves primary page `me` (since me has primary: true) + sidebar footer!
    await dom.render(<OrahakoApp host={host} />)
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.profile&page=me")
    expect(dom.container.textContent).toContain("个人资料")
    expect(dom.container.textContent).toContain("Campus Tool")
    expect(dom.container.textContent).toContain("CUSTOM_ACCOUNT_ACTION")
    expect(dom.container.textContent).toContain("v0.16.0 (b42)")

    // 2. Render Avatar page cleanly
    await act(async () => {
      router.push({ route: "avatar" })
    })
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.profile&page=avatar")
    expect(dom.container.textContent).toContain("自定义头像")

    // 3. Navigate to About page -> renders about.extra & 7-tap version button navigates to Debug!
    await act(async () => {
      router.push({ route: "about" })
    })
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.profile&page=about")
    expect(dom.container.textContent).toContain("ABOUT_EXTRA_ROW")
    expect(dom.container.textContent).toContain("Youwenqwq/orahako")

    const versionBtn = dom.container.findByAttr("data-about-version-trigger")
    expect(versionBtn).toBeDefined()

    for (let i = 0; i < DEBUG_TAP_THRESHOLD; i += 1) {
      await act(async () => {
        versionBtn!.click()
      })
    }

    // 4. Automatically navigated to Debug page & rendered debug.panels!
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.profile&page=debug")
    expect(dom.container.textContent).toContain("平台与运行时")
    expect(dom.container.textContent).toContain("CUSTOM_DEBUG_PANEL")

    // Static markup check in English
    await act(async () => {
      host.i18n?.setLocale("en")
    })
    const debugEnMarkup = renderToStaticMarkup(<OrahakoApp host={host} />)
    expect(debugEnMarkup).toContain("Platform &amp; Runtime")

    activeUnmount = undefined
    await dom.unmount()
    host.dispose()
  })
})
