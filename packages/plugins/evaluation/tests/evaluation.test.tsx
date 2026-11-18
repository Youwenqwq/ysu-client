import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
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
import { PENDING_EVALUATIONS_WIDGET_ID } from "../src/widgets"

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

    // Render OverviewPage + EvaluationPage together to verify cross-view invalidation
    await dom.render(
      <div>
        <ContributionOutlet entry={overviewPage} slots={slots} i18n={i18n} />
        <ContributionOutlet entry={evalPage} slots={slots} i18n={i18n} />
      </div>
    )

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("你有 2 个待评教任务")
      expect(dom.container.textContent).toContain("计算机网络")
      expect(dom.container.textContent).toContain("王教授")
    })
    expect(pendingCalls).toContain("01")

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

    // Stop evaluationPlugin -> widget, page, and navigation are cleanly removed
    await act(async () => {
      runtime.stop(EVALUATION_PLUGIN_ID)
    })

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
