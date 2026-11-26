import {
  hasSlice,
  requireSlice,
  type EvaluationAnswer,
  type EvaluationDetail,
  type EvaluationTask,
  type EvaluationType,
  type ProviderRuntimeService,
  type QueryService,
  type QuerySnapshot,
  type Question,
  type SessionService,
} from "@orahako/academic-sdk"
import { createObservableSource, type ObservableSource, type Translator } from "@orahako/sdk"
import type { EvaluationDictionary } from "./dictionary"

export interface BatchTaskResult {
  readonly task: EvaluationTask
  readonly detail: EvaluationDetail
  readonly answers: Record<string, EvaluationAnswer>
  readonly scoreResult: Record<string, unknown> | null
  readonly status: "pending" | "filling" | "filled" | "submitting" | "submitted" | "failed"
  readonly error?: string
}

export interface TaskStatusDisplay {
  readonly active: boolean
  readonly label: string
  readonly variant: "default" | "secondary" | "destructive" | "outline"
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function renderPreviewValue(value: unknown): string {
  if (value === null || value === undefined) return "-"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(renderPreviewValue).join(", ")}]`
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function resolvePreviewKeyLabel(key: string, t: Translator<EvaluationDictionary>): string {
  switch (key) {
    case "calculateQuestionnaireAnswerScore":
      return t("evaluation.previewKeys.calculateQuestionnaireAnswerScore")
    case "score":
      return t("evaluation.previewKeys.score")
    case "teacherName":
      return t("evaluation.previewKeys.teacherName")
    default:
      return key
  }
}

export function formatAnswerPreview(
  detail: EvaluationDetail,
  answers: Record<string, EvaluationAnswer>
): { readonly order: number; readonly text: string; readonly answer: string }[] {
  return detail.questions.map((question) => {
    const answerEntry = answers[question.tmid]
    let answer = ""
    if (!answerEntry) {
      answer = "-"
    } else if (question.questionType === "01") {
      const opt = question.options.find((o) => answerEntry.optionIds?.includes(o.wid))
      answer = opt ? `${opt.text ?? ""} (${opt.score})` : "-"
    } else if (question.questionType === "07") {
      const opts = question.options.filter((o) => answerEntry.optionIds?.includes(o.wid))
      answer = opts.length > 0 ? opts.map((o) => `${o.text ?? ""} (${o.score})`).join(", ") : "-"
    } else {
      answer = answerEntry.text || "-"
    }
    return { order: question.order, text: question.text || "", answer }
  })
}

export function getTeacherRelationId(task: EvaluationTask, detail: EvaluationDetail): string {
  const firstTeacher = detail.teachers?.[0]
  const relationId = firstTeacher?.PJGXID
  if (typeof relationId === "string" && relationId.length > 0) {
    return relationId
  }
  return task.teacherId || ""
}

export function parseTaskTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const timestamp = new Date(value.replace(" ", "T")).getTime()
  return Number.isFinite(timestamp) ? timestamp : undefined
}

export function isEvaluationTaskActive(task: EvaluationTask, now = Date.now()): boolean {
  const startTimestamp = task.startTimestamp ?? parseTaskTimestamp(task.startAt ?? task.startTime)
  if (startTimestamp !== undefined && now < startTimestamp) {
    return false
  }
  const endTimestamp = task.endTimestamp ?? parseTaskTimestamp(task.endAt ?? task.endTime)
  if (endTimestamp !== undefined && now > endTimestamp) {
    return false
  }
  return task.status !== "not_started" && task.status !== "ended"
}

export function getTaskStatus(
  task: EvaluationTask,
  t: Translator<EvaluationDictionary>,
  now = Date.now()
): TaskStatusDisplay {
  const startTimestamp = task.startTimestamp ?? parseTaskTimestamp(task.startAt ?? task.startTime)
  if (startTimestamp !== undefined && now < startTimestamp) {
    return {
      active: false,
      label: t("evaluation.statusNotStarted"),
      variant: "secondary",
    }
  }
  const endTimestamp = task.endTimestamp ?? parseTaskTimestamp(task.endAt ?? task.endTime)
  if (endTimestamp !== undefined && now > endTimestamp) {
    return {
      active: false,
      label: t("evaluation.statusEnded"),
      variant: "destructive",
    }
  }

  switch (task.status) {
    case "not_started":
      return {
        active: false,
        label: t("evaluation.statusNotStarted"),
        variant: "secondary",
      }
    case "ended":
      return {
        active: false,
        label: t("evaluation.statusEnded"),
        variant: "destructive",
      }
    case "active":
    case "unknown":
    default:
      return {
        active: true,
        label: t("evaluation.statusActive"),
        variant: "default",
      }
  }
}

export function createInitialAnswers(detail: EvaluationDetail): Record<string, EvaluationAnswer> {
  const initial: Record<string, EvaluationAnswer> = {}
  for (const question of detail.questions) {
    initial[question.tmid] = {
      tmid: question.tmid,
      questionType: question.questionType || "",
      optionIds: [],
      text: "",
    }
  }
  return initial
}

export function autoFillMaxScore(
  detail: EvaluationDetail | null,
  baseAnswers?: Record<string, EvaluationAnswer>,
  textAnswer?: string
): { readonly answers: Record<string, EvaluationAnswer>; readonly skipped: Question[] } {
  if (!detail) return { answers: {}, skipped: [] }
  const next: Record<string, EvaluationAnswer> = baseAnswers ? { ...baseAnswers } : {}
  const skipped: Question[] = []
  const text = textAnswer?.trim() || "优秀"

  for (const question of detail.questions) {
    if (question.questionType === "01") {
      const allZero =
        question.options.length > 0 && question.options.every((opt) => opt.score === 0)
      if (allZero) {
        next[question.tmid] = {
          tmid: question.tmid,
          questionType: question.questionType || "",
          optionIds: [],
          text: "",
        }
        skipped.push(question)
        continue
      }
      const best =
        question.options.length > 0
          ? [...question.options].sort((a, b) => b.score - a.score)[0]
          : null
      next[question.tmid] = {
        tmid: question.tmid,
        questionType: question.questionType || "",
        optionIds: best ? [best.wid] : [],
        text: "",
      }
    } else if (question.questionType === "07") {
      const allZero =
        question.options.length > 0 && question.options.every((opt) => opt.score === 0)
      if (allZero) {
        next[question.tmid] = {
          tmid: question.tmid,
          questionType: question.questionType || "",
          optionIds: [],
          text: "",
        }
        skipped.push(question)
        continue
      }
      const positive = question.options.filter((opt) => opt.score > 0)
      const toSelect = positive.length > 0 ? positive : question.options
      next[question.tmid] = {
        tmid: question.tmid,
        questionType: question.questionType || "",
        optionIds: toSelect.map((opt) => opt.wid),
        text: "",
      }
    } else {
      next[question.tmid] = {
        tmid: question.tmid,
        questionType: question.questionType || "",
        optionIds: [],
        text,
      }
    }
  }

  return { answers: next, skipped }
}

export function validateAnswers(
  detail: EvaluationDetail | null,
  answers: Record<string, EvaluationAnswer>,
  t: Translator<EvaluationDictionary>
): string | null {
  if (!detail) return t("evaluation.validation.notLoaded")
  for (const question of detail.questions) {
    const answer = answers[question.tmid]
    if (!answer) return t("evaluation.validation.unanswered", { order: question.order })
    if (question.questionType === "01" && (!answer.optionIds || answer.optionIds.length === 0)) {
      return t("evaluation.validation.singleChoice", { order: question.order })
    }
    if (question.questionType === "07" && (!answer.optionIds || answer.optionIds.length === 0)) {
      return t("evaluation.validation.multiChoice", { order: question.order })
    }
    if (question.questionType !== "01" && question.questionType !== "07" && !answer.text?.trim()) {
      return t("evaluation.validation.text", { order: question.order })
    }
  }
  return null
}

const IDLE_TASKS_SNAPSHOT: QuerySnapshot<EvaluationTask[]> = {
  status: "idle",
  data: undefined,
  error: null,
  isLoading: false,
  isRefreshing: false,
  isStale: false,
  updatedAt: null,
  refresh: async () => undefined,
}

export interface EvaluationSources {
  readonly typesSource: ObservableSource<QuerySnapshot<EvaluationType[]>>
  readonly selectedTypeSource: ObservableSource<string | null>
  readonly pendingTasksSource: ObservableSource<QuerySnapshot<EvaluationTask[]>>
  readonly allTasksSource: ObservableSource<QuerySnapshot<EvaluationTask[]>>
  readonly selectType: (code: string) => Promise<void>
  readonly dispose: () => void
}

export function createEvaluationSources(deps: {
  readonly query: QueryService
  readonly provider: ProviderRuntimeService
  readonly session: SessionService
}): EvaluationSources {
  const { query, provider, session } = deps
  let disposed = false

  const isSliceEnabled = (): boolean =>
    !disposed &&
    session.getSnapshot().isAuthenticated &&
    hasSlice(provider.getSnapshot().provider, "evaluation")

  const typesSource = query.source<EvaluationType[], "evaluation">({
    feature: "evaluation-types",
    slice: "evaluation",
    enabled: isSliceEnabled,
    fetcher: (activeProvider) => requireSlice(activeProvider, "evaluation").getEvaluationTypes(),
  })

  const allTasksSource = query.source<EvaluationTask[], "evaluation">({
    feature: "evaluation-tasks",
    slice: "evaluation",
    enabled: isSliceEnabled,
    fetcher: (activeProvider) => requireSlice(activeProvider, "evaluation").getEvaluationTasks(),
  })

  const userSelectedCode = createObservableSource<string | null>(null)
  let lastIdentityKey = ""

  const computeIdentityKey = (): string => {
    const sess = session.getSnapshot()
    const prov = provider.getSnapshot()
    return `${sess.activeSchoolId ?? ""}|${sess.username ?? ""}|${prov.generation}`
  }

  const unsubSession = session.state.subscribe(() => {
    if (disposed) return
    const nextKey = computeIdentityKey()
    if (nextKey !== lastIdentityKey) {
      lastIdentityKey = nextKey
      userSelectedCode.set(null)
    }
  })

  const unsubProvider = provider.state.subscribe(() => {
    if (disposed) return
    const nextKey = computeIdentityKey()
    if (nextKey !== lastIdentityKey) {
      lastIdentityKey = nextKey
      userSelectedCode.set(null)
    }
  })

  lastIdentityKey = computeIdentityKey()

  const resolveEffectiveType = (): string | null => {
    if (disposed) return null
    const explicit = userSelectedCode.getSnapshot()
    const loadedTypes = typesSource.getSnapshot().data
    if (explicit !== null && explicit.length > 0) {
      if (!loadedTypes || loadedTypes.some((item) => item.code === explicit)) {
        return explicit
      }
    }
    const firstCode = loadedTypes?.[0]?.code
    return firstCode && firstCode.length > 0 ? firstCode : null
  }

  const selectedTypeListeners = new Set<() => void>()
  let unsubSelectedDeps: (() => void) | null = null

  const selectedTypeSource: ObservableSource<string | null> = {
    getSnapshot: resolveEffectiveType,
    subscribe: (listener) => {
      selectedTypeListeners.add(listener)
      if (selectedTypeListeners.size === 1) {
        const notify = () => {
          for (const fn of Array.from(selectedTypeListeners)) fn()
        }
        const offUser = userSelectedCode.subscribe(notify)
        const offTypes = typesSource.subscribe(notify)
        unsubSelectedDeps = () => {
          offUser()
          offTypes()
        }
      }
      return () => {
        selectedTypeListeners.delete(listener)
        if (selectedTypeListeners.size === 0) {
          unsubSelectedDeps?.()
          unsubSelectedDeps = null
        }
      }
    },
  }

  const pendingByType = new Map<string, ObservableSource<QuerySnapshot<EvaluationTask[]>>>()

  const getInnerPendingSource = (
    evalType: string
  ): ObservableSource<QuerySnapshot<EvaluationTask[]>> => {
    const existing = pendingByType.get(evalType)
    if (existing) return existing
    const created = query.source<EvaluationTask[], "evaluation">({
      feature: "pending-evaluations",
      slice: "evaluation",
      params: { evalType },
      enabled: () => isSliceEnabled() && evalType.length > 0,
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "evaluation").getPendingEvaluations(evalType),
    })
    pendingByType.set(evalType, created)
    return created
  }

  const pendingListeners = new Set<() => void>()
  let currentInnerPending: ObservableSource<QuerySnapshot<EvaluationTask[]>> | null = null
  let unsubInnerPending: (() => void) | null = null
  let unsubPendingTypeDep: (() => void) | null = null

  const notifyPendingListeners = (): void => {
    for (const fn of Array.from(pendingListeners)) fn()
  }

  const rebindPending = (emitChange: boolean): void => {
    const activeType = resolveEffectiveType()
    const nextInner = activeType ? getInnerPendingSource(activeType) : null
    if (nextInner === currentInnerPending) return
    unsubInnerPending?.()
    currentInnerPending = nextInner
    unsubInnerPending = currentInnerPending
      ? currentInnerPending.subscribe(notifyPendingListeners)
      : null
    if (emitChange) {
      notifyPendingListeners()
    }
  }

  const pendingTasksSource: ObservableSource<QuerySnapshot<EvaluationTask[]>> = {
    getSnapshot: () => {
      if (pendingListeners.size > 0) {
        return currentInnerPending ? currentInnerPending.getSnapshot() : IDLE_TASKS_SNAPSHOT
      }
      const activeType = resolveEffectiveType()
      return activeType ? getInnerPendingSource(activeType).getSnapshot() : IDLE_TASKS_SNAPSHOT
    },
    subscribe: (listener) => {
      const wasEmpty = pendingListeners.size === 0
      pendingListeners.add(listener)
      if (wasEmpty) {
        rebindPending(false)
        unsubPendingTypeDep = selectedTypeSource.subscribe(() => {
          rebindPending(true)
        })
      }
      return () => {
        pendingListeners.delete(listener)
        if (pendingListeners.size === 0) {
          unsubPendingTypeDep?.()
          unsubPendingTypeDep = null
          unsubInnerPending?.()
          unsubInnerPending = null
          currentInnerPending = null
        }
      }
    },
  }

  const selectType = async (code: string): Promise<void> => {
    if (!code || disposed) return
    const previous = resolveEffectiveType()
    userSelectedCode.set(code)
    if (previous === code) {
      await getInnerPendingSource(code).getSnapshot().refresh()
    }
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubSession()
    unsubProvider()
    unsubPendingTypeDep?.()
    unsubPendingTypeDep = null
    unsubInnerPending?.()
    unsubInnerPending = null
    currentInnerPending = null
    unsubSelectedDeps?.()
    unsubSelectedDeps = null
    pendingListeners.clear()
    selectedTypeListeners.clear()
    pendingByType.clear()
  }

  return {
    typesSource,
    selectedTypeSource,
    pendingTasksSource,
    allTasksSource,
    selectType,
    dispose,
  }
}
