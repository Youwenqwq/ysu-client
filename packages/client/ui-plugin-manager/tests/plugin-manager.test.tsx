import { zipSync } from "fflate"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as SdkNamespace from "@orahako/sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type MarketplaceIndex,
} from "@orahako/sdk"
import { createMemoryPackageBackend, PluginHost, PluginPackageStore } from "@orahako/kernel"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { routerRuntimePlugin } from "@orahako/runtime-router"
import { ContributionOutlet, slotRegistryPlugin } from "@orahako/runtime-slots"
import { storageRuntimePlugin } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import { groupByPluginCategory, pluginCategory, pluginManagerPlugin } from "../src/index"

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
    if (nodeType === 1) this.tagName = nodeName
  }

  get firstChild(): MiniDomNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniDomNode | null {
    if (!this.parentNode) return null
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
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
    const idx = this.childNodes.indexOf(before)
    child.parentNode = this
    if (idx >= 0) this.childNodes.splice(idx, 0, child)
    else this.childNodes.push(child)
    return child
  }

  removeChild(child: MiniDomNode): MiniDomNode {
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

  addEventListener(): void {}
  removeEventListener(): void {}
  closest(): null {
    return null
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }
  }

  set textContent(value: string) {
    this.childNodes.length = 0
    this.rawText = String(value)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((c) => c.textContent).join("")
  }
}

function mountDom() {
  const globals = globalThis as Record<string, unknown>
  const prevWin = globals.window
  const prevDoc = globals.document
  const prevAct = globals.IS_REACT_ACT_ENVIRONMENT
  const prevForm = globals.HTMLFormElement
  const prevElem = globals.HTMLElement

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLFormElement: class {},
    HTMLElement: MiniDomNode,
    confirm: vi.fn(() => true),
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

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.window = fakeWin
  globals.document = docWithFactories
  globals.HTMLFormElement = fakeWin.HTMLFormElement
  globals.HTMLElement = MiniDomNode

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
      globals.window = prevWin
      globals.document = prevDoc
      globals.IS_REACT_ACT_ENVIRONMENT = prevAct
      globals.HTMLFormElement = prevForm
      globals.HTMLElement = prevElem
    },
  }
}

describe("@orahako/ui-plugin-manager", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("classifies and groups plugins by kind and category in canonical order", () => {
    expect(pluginCategory({ kind: "provider" })).toBe("provider")
    expect(pluginCategory({ kind: "runtime" })).toBe("system")
    expect(pluginCategory({ kind: "shell" })).toBe("system")
    expect(pluginCategory({ kind: "feature", required: true })).toBe("system")
    expect(pluginCategory({ kind: "theme" })).toBe("appearance")
    expect(pluginCategory({ kind: "feature", categories: ["toybox"] })).toBe("toybox")
    expect(pluginCategory({ kind: "feature" })).toBe("academic")

    const grouped = groupByPluginCategory([
      { id: "t", kind: "theme" as const },
      { id: "a", kind: "feature" as const },
      { id: "p", kind: "provider" as const },
    ])
    expect(grouped.map((g) => g.id)).toEqual(["provider", "academic", "appearance"])
  })

  it("registers plugins page & navigation, renders installed/shells/market/bundles, and supports sideload & uninstall", async () => {
    let blobCounter = 0
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      const code = blob instanceof Blob ? "export default { apply() {} }" : ""
      return `data:text/javascript;base64,${btoa(code)}#pm-${++blobCounter}`
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})

    const encoder = new TextEncoder()
    const extZipV1 = zipSync({
      "manifest.json": encoder.encode(
        JSON.stringify({
          id: "community.toy",
          name: "Community Toy",
          version: "1.0.0",
          apiVersion: 1,
          kind: "feature",
          categories: ["toybox"],
          entry: "index.js",
        })
      ),
      "index.js": encoder.encode("export default { apply() {} }\n"),
    })

    const marketIndex: MarketplaceIndex = {
      schemaVersion: 1,
      updatedAt: "2026-11-18T00:00:00Z",
      plugins: [
        {
          id: "community.toy",
          name: "Community Toy",
          summary: "Fun campus toy",
          author: "orahako",
          categories: ["toybox"],
          versions: [
            {
              version: "9.0.0",
              apiVersion: 2, // ignored legacy v2
              platforms: ["web", "android"],
              zipUrl: "/v2/toy.zip",
              sha256: "a".repeat(64),
              size: 100,
              publishedAt: "2026-01-01T00:00:00Z",
            },
            {
              version: "1.5.0",
              apiVersion: 1,
              platforms: ["web", "android"],
              zipUrl: "/v1/toy-1.5.0.zip",
              sha256: "b".repeat(64),
              size: 200,
              publishedAt: "2026-11-18T00:00:00Z",
            },
          ],
        },
        {
          id: "community.theme",
          name: "Mint Theme",
          summary: "Fresh mint palette",
          author: "orahako",
          categories: ["theme"],
          versions: [
            {
              version: "1.0.0",
              apiVersion: 1,
              platforms: ["web", "android"],
              zipUrl: "/v1/mint-1.0.0.zip",
              sha256: "c".repeat(64),
              size: 150,
              publishedAt: "2026-11-18T00:00:00Z",
            },
          ],
        },
      ],
      bundles: [
        {
          id: "ysu-starter",
          name: "燕大推荐扩展包",
          schoolId: "ysu",
          pluginIds: ["community.toy", "community.theme"],
        },
      ],
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(marketIndex), { status: 200 }))
    )

    const shellA = definePlugin({
      manifest: {
        id: "orahako.shell",
        name: "Default Shell",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        required: true,
        entry: "index.js",
        inject: ["ui"],
      },
      inject: ["ui"] as const,
      apply(ctx) {
        ctx.ui.registerShell({ id: "default", name: "酸橙盒默认" }, (props) => props.children)
        ctx.ui.registerShell({ id: "compact", name: "紧凑界面" }, (props) => props.children)
      },
    })

    const optionalFeature = definePlugin({
      manifest: {
        id: "demo.grades",
        name: "成绩查询",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      apply() {},
    })

    const requiredFeature = definePlugin({
      manifest: {
        id: "demo.required",
        name: "必需插件",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        required: true,
      },
      apply() {},
    })

    const providerState = createObservableSource({
      schoolId: "ysu",
      provider: { id: "ysu", supportedPlugins: ["demo.grades"] },
    })

    const host = new PluginHost(
      {
        appVersion: "0.17.0",
        appBuild: "b1",
        composition: {
          id: "test.pm",
          version: 1,
          defaults: { shell: "orahako.shell:default" },
          market: { indexUrl: "https://market.example.com/plugins.json" },
          plugins: [
            { id: slotRegistryPlugin.manifest.id, protected: true },
            { id: uiRegistryPlugin.manifest.id, protected: true },
            { id: routerRuntimePlugin.manifest.id, protected: true },
            { id: i18nRegistryPlugin.manifest.id, protected: true },
            { id: storageRuntimePlugin.manifest.id, protected: true },
            { id: shellA.manifest.id, protected: true },
            { id: optionalFeature.manifest.id },
            { id: requiredFeature.manifest.id },
            { id: pluginManagerPlugin.manifest.id, protected: true },
          ],
        },
        plugins: [
          slotRegistryPlugin,
          uiRegistryPlugin,
          routerRuntimePlugin,
          i18nRegistryPlugin,
          storageRuntimePlugin,
          shellA,
          optionalFeature,
          requiredFeature,
          pluginManagerPlugin,
        ],
      },
      {
        platformModules: { "@orahako/sdk": SdkNamespace },
        packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
      }
    )
    const setContextService: (name: string, value: object) => void = host.runtime.context.set.bind(
      host.runtime.context
    )
    setContextService("provider", { state: providerState })

    try {
      await host.bootstrap()
      // Sideload external v1.0.0 toy plugin via packageRuntime!
      const pkgRuntime = host.runtime.context.get("packageRuntime")!
      await pkgRuntime.installPackage!(extZipV1)

      const pageEntry = host.ui?.findPage("orahako.plugin-manager", "plugins")
      const navEntry = host.ui?.findNavigation("plugins")
      expect(pageEntry).toMatchObject({
        id: "plugins",
        route: "plugins",
        titleKey: "title",
        requiresProvider: false,
        parent: "me",
      })
      expect(navEntry).toMatchObject({
        id: "plugins",
        titleKey: "title",
        page: "plugins",
        group: "account",
      })

      // Static SSR check
      const staticHtml = renderToStaticMarkup(
        <ContributionOutlet entry={pageEntry!} slots={host.slots} i18n={host.i18n} />
      )
      expect(staticHtml).toContain("已安装插件")
      expect(staticHtml).toContain("酸橙盒默认")
      expect(staticHtml).toContain("紧凑界面")
      // `required` in a manifest does not self-grant protection; only composition policy does.
      expect(staticHtml).toContain('aria-label="启用或停用 必需插件"')

      // Interactive mount loads installed packages, market v3 releases, update badge, and school bundle
      const dom = mountDom()
      await dom.render(
        <ContributionOutlet entry={pageEntry!} slots={host.slots} i18n={host.i18n} />
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      const text = dom.container.textContent
      expect(text).toContain("Community Toy")
      expect(text).toContain("卸载")
      expect(text).toContain("燕大推荐扩展包")
      expect(text).toContain("v1.0.0 → v1.5.0")
      expect(text).not.toContain("v9.0.0") // v2 release filtered out!
      expect(text).toContain("更新全部（1）")
      expect(text).toContain("Mint Theme")

      await dom.unmount()
    } finally {
      host.dispose()
    }
  })
})
