import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type EvaluationDetail,
  type EvaluationScoreInput,
  type EvaluationSubmitInput,
  type EvaluationTask,
  type EvaluationType,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { overviewPlugin, OVERVIEW_PLUGIN_ID } from "@orahako/plugin-overview"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  createTranslator,
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
  type PluginRouterService,
} from "@orahako/sdk"
import * as evaluationExports from "../src"
import { EVALUATION_PLUGIN_ID, evaluationPlugin, type EvaluationPageInject } from "../src"
import { evaluationDictionary } from "../src/dictionary"
import {
  autoFillMaxScore,
  formatAnswerPreview,
  getTaskStatus,
  getTeacherRelationId,
  isEvaluationTaskActive,
  resolvePreviewKeyLabel,
  validateAnswers,
} from "../src/helpers"
import { EVALUATION_SUMMARY_WIDGET_ID, PENDING_EVALUATIONS_WIDGET_ID } from "../src/widgets"

vi.mock("@orahako/ui-primitives", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const PassThrough = ({ children }: { children: ReactNode }) => <>{children}</>
  return {
    ...actual,
    ResponsiveModal: ({ open, children }: { open?: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    ResponsiveModalContent: PassThrough,
    ResponsiveModalHeader: PassThrough,
    ResponsiveModalTitle: PassThrough,
    ResponsiveModalDescription: PassThrough,
    ResponsiveModalBody: PassThrough,
    ResponsiveModalFooter: PassThrough,
    Checkbox: ({
      checked,
      onCheckedChange,
    }: {
      checked?: boolean
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheckedChange?.(!checked)}
      />
    ),
  }
})

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniDomNode[] = []
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = undefined
  activeElement: MiniDomNode | null = null
  nodeValue?: string
  id = ""
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

  get children(): MiniDomNode[] {
    return this.childNodes.filter((node) => node.nodeType === 1)
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

  contains(node: MiniDomNode | null): boolean {
    for (let cursor = node; cursor; cursor = cursor.parentNode) {
      if (cursor === this) return true
    }
    return false
  }

  insertAdjacentElement(position: string, node: MiniDomNode): void {
    this.insertBefore(node, position === "afterbegin" ? this.firstChild : null)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
    if (name === "id") this.id = String(value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  blur(): void {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null
  }

  querySelectorAll(): MiniDomNode[] {
    return []
  }

  remove(): void {
    this.parentNode?.removeChild(this)
  }

  querySelector(): MiniDomNode | null {
    return null
  }

  dispatchEvent(): boolean {
    return true
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, width: 160, height: 220, right: 160, bottom: 220 }
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

function findNode(
  root: MiniDomNode,
  predicate: (node: MiniDomNode) => boolean
): MiniDomNode | null {
  if (predicate(root)) return root
  for (const child of root.childNodes) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

function getReactProps(node: MiniDomNode): Record<string, unknown> | null {
  const record = Object(node) as Record<string, unknown>
  const key = Object.keys(record).find((k) => k.startsWith("__reactProps$"))
  if (!key) return null
  const val = record[key]
  return typeof val === "object" && val !== null ? (val as Record<string, unknown>) : null
}

function mountMiniDom() {
  const globalRecord: Record<string, unknown> = globalThis
  const prevWindow = globalRecord.window
  const prevDocument = globalRecord.document
  const prevAct = globalRecord.IS_REACT_ACT_ENVIRONMENT
  const doc = new MiniDomNode(9, "#document")

  const fakeWin = {
    event: undefined,
    document: doc,
    innerWidth: 390,
    innerHeight: 844,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({ animationName: "none", display: "block" }),
    HTMLIFrameElement: class {},
    location: { pathname: "/", search: "", href: "/", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
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
    createTreeWalker: () => ({ nextNode: () => null }),
    getElementById: (id: string) => findNode(doc, (node) => node.id === id),
  })
  const documentElement = docWithFactories.createElement("html")
  const head = docWithFactories.createElement("head")
  const body = docWithFactories.createElement("body")
  documentElement.appendChild(head)
  documentElement.appendChild(body)
  doc.appendChild(documentElement)
  Object.assign(doc, { documentElement, head, body, activeElement: body })

  vi.stubGlobal("HTMLElement", MiniDomNode)
  vi.stubGlobal("HTMLInputElement", class {})
  vi.stubGlobal("Element", MiniDomNode)
  vi.stubGlobal("Node", MiniDomNode)
  vi.stubGlobal("getComputedStyle", fakeWin.getComputedStyle)
  vi.stubGlobal("NodeFilter", { SHOW_ELEMENT: 1 })
  vi.stubGlobal(
    "CustomEvent",
    class {
      preventDefault() {}
    }
  )
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe() {}
      disconnect() {}
    }
  )

  globalRecord.IS_REACT_ACT_ENVIRONMENT = true
  globalRecord.window = fakeWin
  globalRecord.document = docWithFactories

  const container = docWithFactories.createElement("div")
  body.appendChild(container)
  const root = createRoot(container as never)

  return {
    container,
    body,
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
      vi.unstubAllGlobals()
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

describe("@orahako/plugin-evaluation", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(evaluationExports).sort()).toEqual([
      "EVALUATION_PLUGIN_ID",
      "default",
      "evaluationPlugin",
    ])
    expect(evaluationExports.default).toBe(evaluationPlugin)
    expect(EVALUATION_PLUGIN_ID).toBe("orahako.evaluation")
  })

  it("handles rubric auto-fill, zero-score skips, answer validation, task status, and preview labels", () => {
    const tZh = createTranslator(evaluationDictionary, () => "zh")

    const detail: EvaluationDetail = {
      wjid: "wj-100",
      name: "期末评教问卷",
      teachers: [{ PJGXID: "REL-88" }],
      questions: [
        {
          tmid: "q1",
          questionType: "01",
          maxScore: 50,
          order: 1,
          text: "教学态度",
          options: [
            { wid: "o1", text: "一般", score: 30, scoreRatio: 0.6 },
            { wid: "o2", text: "优秀", score: 50, scoreRatio: 1 },
          ],
        },
        {
          tmid: "q2",
          questionType: "07",
          maxScore: 30,
          order: 2,
          text: "课堂亮点",
          options: [
            { wid: "m1", text: "互动充分", score: 15, scoreRatio: 0.5 },
            { wid: "m2", text: "内容深入", score: 15, scoreRatio: 0.5 },
            { wid: "m3", text: "无", score: 0, scoreRatio: 0 },
          ],
        },
        {
          tmid: "q3",
          questionType: "02",
          maxScore: 20,
          order: 3,
          text: "主观建议",
          options: [],
        },
      ],
    }

    const { answers, skipped } = autoFillMaxScore(detail, undefined, "讲课清晰")
    expect(skipped).toEqual([])
    expect(answers.q1?.optionIds).toEqual(["o2"])
    expect(answers.q2?.optionIds).toEqual(["m1", "m2"])
    expect(answers.q3?.text).toBe("讲课清晰")
    expect(validateAnswers(detail, answers, tZh)).toBeNull()

    const preview = formatAnswerPreview(detail, answers)
    expect(preview).toEqual([
      { order: 1, text: "教学态度", answer: "优秀 (50)" },
      { order: 2, text: "课堂亮点", answer: "互动充分 (15), 内容深入 (15)" },
      { order: 3, text: "主观建议", answer: "讲课清晰" },
    ])

    // Zero-score skip detection
    const zeroDetail: EvaluationDetail = {
      questions: [
        {
          tmid: "z1",
          questionType: "01",
          maxScore: 0,
          order: 1,
          text: "调查题",
          options: [{ wid: "zo1", text: "A", score: 0, scoreRatio: 0 }],
        },
      ],
    }
    const zeroFilled = autoFillMaxScore(zeroDetail)
    expect(zeroFilled.skipped).toHaveLength(1)
    expect(validateAnswers(zeroDetail, zeroFilled.answers, tZh)).toContain("第 1 题")

    const task: EvaluationTask = {
      wid: "t1",
      sequence: 1,
      teacherId: "FALLBACK-T",
      startTimestamp: 1000,
      endTimestamp: 5000,
    }
    expect(getTeacherRelationId(task, detail)).toBe("REL-88")
    expect(isEvaluationTaskActive(task, 500)).toBe(false)
    expect(isEvaluationTaskActive(task, 3000)).toBe(true)
    expect(isEvaluationTaskActive(task, 6000)).toBe(false)
    expect(getTaskStatus(task, tZh, 500).label).toBe("未开始")
    expect(getTaskStatus(task, tZh, 6000).label).toBe("已结束")
    expect(resolvePreviewKeyLabel("calculateQuestionnaireAnswerScore", tZh)).toBe("评教得分")
    expect(resolvePreviewKeyLabel("customKey", tZh)).toBe("customKey")
  })

  it("registers page, navigation, and pending-evaluations overview widget, switches types, submits evaluation + invalidates queries, navigates from overview widget, and cleans up on stop", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    let tasksByType: Record<string, EvaluationTask[]> = {
      "01": [
        {
          wid: "task-1",
          wjid: "wj-1",
          courseName: "计算机网络",
          teacherName: "王教授",
          termName: "2026-2027-1",
          className: "计科25-1",
          evalType: "01",
          groupNo: "GRP-1",
          sequence: 1,
          status: "active",
        },
      ],
      "02": [
        {
          wid: "task-2",
          wjid: "wj-2",
          courseName: "编译原理实验",
          teacherName: "赵老师",
          termName: "2026-2027-1",
          className: "计科25-1",
          evalType: "02",
          groupNo: "GRP-2",
          sequence: 2,
          status: "active",
        },
      ],
    }

    const pendingCalls: string[] = []
    const calculateSpy = vi.fn(async (input: EvaluationScoreInput) => ({
      calculateQuestionnaireAnswerScore: 98,
      teacherName: input.teacherName ?? "",
    }))
    const submitSpy = vi.fn(async (input: EvaluationSubmitInput) => {
      tasksByType = {
        ...tasksByType,
        [input.evalType]: (tasksByType[input.evalType] ?? []).filter(
          (item) => item.groupNo !== input.groupNo
        ),
      }
    })

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "demo-school",
      name: "示例大学",
      slices: {
        evaluation: {
          getEvaluationTypes: async (): Promise<EvaluationType[]> => [
            { name: "期末评教", code: "01", count: tasksByType["01"]?.length ?? 0 },
            { name: "实验评教", code: "02", count: tasksByType["02"]?.length ?? 0 },
          ],
          getPendingEvaluations: async (evalType: string): Promise<EvaluationTask[]> => {
            pendingCalls.push(evalType)
            return tasksByType[evalType] ?? []
          },
          getEvaluationTasks: async (): Promise<EvaluationTask[]> => [
            ...(tasksByType["01"] ?? []),
            ...(tasksByType["02"] ?? []),
          ],
          getEvaluationDetail: async (): Promise<EvaluationDetail> => ({
            wjid: "wj-1",
            name: "2026秋季评教表",
            teachers: [{ PJGXID: "REL-101" }],
            questions: [
              {
                tmid: "q-single",
                questionType: "01",
                maxScore: 100,
                order: 1,
                text: "总体评价",
                options: [{ wid: "opt-a", text: "非常满意", score: 100, scoreRatio: 1 }],
              },
            ],
          }),
          calculateEvaluationScore: calculateSpy,
          submitEvaluation: submitSpy,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
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
      settingsRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providerPlugin,
      overviewPlugin,
      evaluationPlugin,
    ]) {
      if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "demo-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const router = runtime.context.get("router") as PluginRouterService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const overview = runtime.context.get("overview")!
    slots.declare({ name: "shell.header.actions", kind: "list" })

    const invalidatedFeatures: string[] = []
    runtime.context.on("query/invalidate", (identity) => {
      if (identity?.feature) invalidatedFeatures.push(identity.feature)
    })

    // Verify page, navigation, and overview widget registrations
    const evalPage = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === EVALUATION_PLUGIN_ID && entry.id === "index")!
    expect(evalPage.route).toBe("evaluation")
    expect(evalPage.capability).toBe("evaluation")

    const evalNav = ui
      .getSnapshot()
      .navigation.find(
        (entry) => entry.pluginId === EVALUATION_PLUGIN_ID && entry.id === "evaluation"
      )!
    expect(evalNav.capability).toBe("evaluation")
    expect("group" in evalNav ? evalNav.group : undefined).toBe("academic")

    const widgetContribution = overview
      .getSnapshot()
      .find(
        (item) =>
          item.pluginId === EVALUATION_PLUGIN_ID && item.id === PENDING_EVALUATIONS_WIDGET_ID
      )
    expect(widgetContribution).toBeDefined()
    expect(widgetContribution?.region).toBe("content")
    expect(widgetContribution?.slice).toBe("evaluation")
    const summaryContribution = overview
      .getSnapshot()
      .find(
        (item) => item.pluginId === EVALUATION_PLUGIN_ID && item.id === EVALUATION_SUMMARY_WIDGET_ID
      )
    expect(summaryContribution).toMatchObject({
      region: "summary",
      slice: "evaluation",
      defaultVisible: false,
    })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "demo-school",
      credential: "ticket-eval",
      username: "20250606",
    })
    await providerRuntime.initialize()

    const overviewPage = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === OVERVIEW_PLUGIN_ID && entry.id === "index")!

    const headerActions = slots.select("shell.header.actions")[0]!
    router.push({ route: "grades" })

    // Render OverviewPage + EvaluationPage together to verify cross-view invalidation
    await dom.render(
      <div>
        <header>
          <ContributionOutlet entry={headerActions} slots={slots} i18n={i18n} />
        </header>
        <ContributionOutlet entry={overviewPage} slots={slots} i18n={i18n} />
        <main>
          <ContributionOutlet entry={evalPage} slots={slots} i18n={i18n} />
        </main>
      </div>
    )
    const header = findNode(dom.container, (node) => node.tagName === "HEADER")!
    const main = findNode(dom.container, (node) => node.tagName === "MAIN")!
    const isTypeMenu = (node: MiniDomNode) => node.attributes.get("aria-haspopup") === "menu"
    const isBatchButton = (node: MiniDomNode) =>
      node.attributes.get("aria-label") === "批量自动评教"

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("你有 2 个待评教任务")
      expect(dom.container.textContent).toContain("计算机网络")
      expect(dom.container.textContent).toContain("王教授")
    })
    expect(header.childNodes).toHaveLength(0)
    expect(findNode(main, isTypeMenu)).toBeNull()
    expect(findNode(main, isBatchButton)).toBeNull()
    expect(pendingCalls).toContain("01")

    const summarySlot = slots.select(
      "overview.widget",
      `${EVALUATION_PLUGIN_ID}:${EVALUATION_SUMMARY_WIDGET_ID}`
    )[0]!
    const summaryHtml = renderToStaticMarkup(
      <ContributionOutlet entry={summarySlot} slots={slots} i18n={i18n} />
    )
    expect(summaryHtml).toContain("评教数量")
    expect(summaryHtml).toContain(">2</span>")

    // Click widget link to navigate to evaluation route
    const widgetLink = findNode(dom.container, (node) =>
      node.attributes.has("data-evaluation-widget-link")
    )
    expect(widgetLink).not.toBeNull()
    await act(async () => {
      const linkProps = getReactProps(widgetLink!)
      const onClick = linkProps?.onClick
      if (typeof onClick === "function") {
        onClick({
          defaultPrevented: false,
          button: 0,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          preventDefault: vi.fn(),
        })
      }
    })
    expect(router.current.getSnapshot().route).toBe("evaluation")
    const batchButton = findNode(header, isBatchButton)!
    const typeMenu = findNode(header, isTypeMenu)!
    expect(typeMenu.textContent).toBe("期末评教")
    expect(batchButton.textContent).toBe("")
    expect(batchButton.nextSibling).toBe(typeMenu)

    await act(async () => {
      const onClick = getReactProps(batchButton)?.onClick
      expect(typeof onClick).toBe("function")
      if (typeof onClick === "function") onClick()
    })
    const dialog = findNode(dom.body, (node) => node.getAttribute("role") === "dialog")!
    expect(dialog.textContent).toContain("请选择需要批量自动评教的任务")
    expect(dialog.textContent).toContain("计算机网络")
    expect(dialog.textContent).not.toContain("编译原理实验")
    for (const label of ["全选", "取消"]) {
      const button = findNode(
        dialog,
        (node) => node.tagName === "BUTTON" && node.textContent === label
      )!
      await act(async () => {
        const onClick = getReactProps(button)?.onClick
        expect(typeof onClick).toBe("function")
        if (typeof onClick === "function") onClick()
      })
      if (label === "全选") expect(dialog.textContent).toContain("已选择 1 个")
    }
    expect(findNode(dom.body, (node) => node.getAttribute("role") === "dialog")).toBeNull()

    // Switch evaluation type to "02" via type button
    const type2Button = findNode(
      dom.container,
      (node) => node.attributes.get("data-evaluation-type") === "02"
    )
    expect(type2Button).not.toBeNull()
    await act(async () => {
      const btnProps = getReactProps(type2Button!)
      const onClick = btnProps?.onClick
      if (typeof onClick === "function") {
        onClick()
      }
    })

    await vi.waitFor(() => {
      expect(pendingCalls).toContain("02")
      expect(dom.container.textContent).toContain("编译原理实验")
      expect(dom.container.textContent).toContain("赵老师")
      expect(typeMenu.textContent).toBe("实验评教")
    })

    // Exercise fetchDetail, calculateScore, and submitEvaluation via page inject contract
    const injected = evalPage.inject!(runtime.context) as EvaluationPageInject
    const detail = await injected.fetchDetail({
      groupNo: "GRP-2",
      evalType: "02",
      sequence: 2,
    })
    expect(detail.name).toBe("2026秋季评教表")

    const scoreRes = await injected.calculateScore({
      groupNo: "GRP-2",
      wjid: "wj-2",
      evalType: "02",
      answers: [{ tmid: "q-single", questionType: "01", optionIds: ["opt-a"], text: "" }],
      teacherRelationId: "REL-101",
      courseName: "编译原理实验",
      teacherName: "赵老师",
      sequence: 2,
    })
    expect(calculateSpy).toHaveBeenCalledTimes(1)
    expect(scoreRes).toEqual({
      calculateQuestionnaireAnswerScore: 98,
      teacherName: "赵老师",
    })

    await act(async () => {
      await injected.submitEvaluation({
        groupNo: "GRP-2",
        wjid: "wj-2",
        evalType: "02",
        answers: [{ tmid: "q-single", questionType: "01", optionIds: ["opt-a"], text: "" }],
        teacherRelationId: "REL-101",
        courseName: "编译原理实验",
        teacherName: "赵老师",
        sequence: 2,
      })
    })

    expect(submitSpy).toHaveBeenCalledTimes(1)
    expect(invalidatedFeatures).toEqual(
      expect.arrayContaining(["evaluation-types", "pending-evaluations", "evaluation-tasks"])
    )

    // Both page ("暂无待评任务" for type "02") and overview widget ("你有 1 个待评教任务") updated!
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("暂无待评任务")
      expect(dom.container.textContent).toContain("你有 1 个待评教任务")
      expect(findNode(header, isBatchButton)).toBeNull()
    })

    // Submit the remaining task -> overview widget hides completely when 0 active tasks remain
    await act(async () => {
      await injected.submitEvaluation({
        groupNo: "GRP-1",
        wjid: "wj-1",
        evalType: "01",
        answers: [{ tmid: "q-single", questionType: "01", optionIds: ["opt-a"], text: "" }],
        teacherRelationId: "REL-101",
        courseName: "计算机网络",
        teacherName: "王教授",
        sequence: 1,
      })
    })

    await vi.waitFor(() => {
      expect(dom.container.textContent).not.toContain("待评教任务")
    })

    await act(async () => router.push({ pluginId: EVALUATION_PLUGIN_ID, pageId: "missing" }))
    expect(header.childNodes).toHaveLength(0)
    await act(async () => router.push({ pluginId: EVALUATION_PLUGIN_ID }))
    expect(findNode(header, isTypeMenu)?.textContent).toBe("实验评教")

    // Stop evaluationPlugin -> widget, page, and navigation are cleanly removed
    await act(async () => {
      runtime.stop(EVALUATION_PLUGIN_ID)
    })
    expect(slots.select("shell.header.actions")).toEqual([])

    expect(overview.getSnapshot().some((item) => item.pluginId === EVALUATION_PLUGIN_ID)).toBe(
      false
    )
    expect(
      slots.select("overview.widget", `${EVALUATION_PLUGIN_ID}:${PENDING_EVALUATIONS_WIDGET_ID}`)
    ).toEqual([])
    expect(ui.getSnapshot().pages.some((entry) => entry.pluginId === EVALUATION_PLUGIN_ID)).toBe(
      false
    )
    expect(
      ui.getSnapshot().navigation.some((entry) => entry.pluginId === EVALUATION_PLUGIN_ID)
    ).toBe(false)

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
