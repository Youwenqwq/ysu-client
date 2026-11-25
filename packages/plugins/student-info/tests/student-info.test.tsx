import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type SchoolProvider, type StudentInfo } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as studentInfoExports from "../src"
import { STUDENT_INFO_PLUGIN_ID, studentInfoPlugin } from "../src"

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
      this[name] = value
    },
    removeProperty(name: string) {
      delete this[name]
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
}

function mountMiniDom() {
  const globalRecord: Record<string, unknown> = globalThis
  const prevWindow = globalRecord.window
  const prevDocument = globalRecord.document
  const prevAct = globalRecord.IS_REACT_ACT_ENVIRONMENT

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

  globalRecord.IS_REACT_ACT_ENVIRONMENT = true
  globalRecord.window = fakeWin
  globalRecord.document = docWithFactories

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
      globalRecord.IS_REACT_ACT_ENVIRONMENT = prevAct
      globalRecord.window = prevWindow
      globalRecord.document = prevDocument
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

function createMemoryStorage(): PluginKeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

describe("@orahako/plugin-student-info", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(studentInfoExports).sort()).toEqual([
      "STUDENT_INFO_PLUGIN_ID",
      "default",
      "studentInfoPlugin",
    ])
    expect(studentInfoExports.default).toBe(studentInfoPlugin)
    expect(STUDENT_INFO_PLUGIN_ID).toBe("orahako.student-info")
  })

  it("registers student-info page & navigation, binds studentProfile query.source, renders zh/en fields, and cleans up on dispose", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const getStudentInfoSpy = vi.fn(
      async (): Promise<StudentInfo> => ({
        name: "林知夏",
        namePinyin: "LIN ZHIXIA",
        studentId: "20250808",
        gender: "女",
        nation: "汉族",
        department: "信息科学与工程学院",
        major: "软件工程",
        className: "软工25-1",
        gradeLevel: "2025",
        campus: "东校区",
        studentStatus: "在籍",
        studyDuration: "4",
        foreignLanguage: "英语",
      })
    )

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "demo-school",
      name: "示例大学",
      slices: {
        studentProfile: {
          getStudentInfo: getStudentInfoSpy,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })

    const providerPlugin = definePlugin({
      manifest: {
        id: "test.provider",
        name: "Test Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("demo-school", () => schoolProvider)
      },
    })

    const runtime = new PluginRuntime()
    runtime.context.set(
      "storage",
      new NamespacedStorageService({
        local: createMemoryStorage(),
        secure: createMemoryStorage(),
      })
    )
    runtime.context.set("http", new StatelessHttpService())

    for (const plugin of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providerPlugin,
      studentInfoPlugin,
    ]) {
      if (plugin.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(plugin, "builtin", { policies: {} })
      } else if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "demo-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("student-info")).toEqual({ ttl: LONG_TTL_MS, persist: true })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    const page = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === STUDENT_INFO_PLUGIN_ID && entry.id === "index")
    expect(page).toBeDefined()
    expect(page?.route).toBe("student-info")
    expect(page?.capability).toBe("studentProfile")
    expect(page?.parent).toBe("me")

    const nav = ui
      .getSnapshot()
      .navigation.find(
        (entry) => entry.pluginId === STUDENT_INFO_PLUGIN_ID && entry.id === "student-info"
      )
    expect(nav).toBeDefined()
    expect(nav?.capability).toBe("studentProfile")
    expect(nav && "group" in nav ? nav.group : undefined).toBe("academic")

    // Unauthenticated before setCredential -> query does not run
    expect(getStudentInfoSpy).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "demo-school",
      credential: "ticket-1",
      username: "20250808",
    })
    await providerRuntime.initialize()

    await dom.render(<ContributionOutlet entry={page!} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(getStudentInfoSpy).toHaveBeenCalledTimes(1)
      expect(dom.container.textContent).toContain("学生基本信息")
      expect(dom.container.textContent).toContain("林知夏")
      expect(dom.container.textContent).toContain("LIN ZHIXIA")
      expect(dom.container.textContent).toContain("信息科学与工程学院")
      expect(dom.container.textContent).toContain("软工25-1")
      // Unset optional fields (e.g. nationality / enrollmentDate) fall back to "-"
      expect(dom.container.textContent).toContain("-")
    })

    await act(async () => {
      i18n.setLocale("en")
    })

    expect(dom.container.textContent).toContain("Student Info")
    expect(dom.container.textContent).toContain("Personal academic information")
    expect(dom.container.textContent).toContain("Department")

    await act(async () => {
      runtime.stop(STUDENT_INFO_PLUGIN_ID)
    })

    expect(ui.getSnapshot().pages.some((entry) => entry.pluginId === STUDENT_INFO_PLUGIN_ID)).toBe(
      false
    )
    expect(
      ui.getSnapshot().navigation.some((entry) => entry.pluginId === STUDENT_INFO_PLUGIN_ID)
    ).toBe(false)
    expect(rootQuery.policy("student-info")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
