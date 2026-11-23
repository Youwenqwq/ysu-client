import { useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronRight, ClipboardCheck, Sparkles } from "lucide-react"
import { toast } from "sonner"
import type {
  EvaluationAnswer,
  EvaluationDetail,
  EvaluationDetailQuery,
  EvaluationScoreInput,
  EvaluationSubmitInput,
  EvaluationTask,
  EvaluationType,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  Question,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
  Label,
  Progress,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  Skeleton,
  Spinner,
  Textarea,
  useErrorToast,
} from "@orahako/ui-primitives"
import type { EvaluationDictionary } from "./dictionary"
import type { EvaluationViewStoreInstance } from "./view-store"
import {
  autoFillMaxScore,
  createInitialAnswers,
  formatAnswerPreview,
  getTaskStatus,
  getTeacherRelationId,
  isPlainRecord,
  renderPreviewValue,
  resolvePreviewKeyLabel,
  validateAnswers,
  type BatchTaskResult,
} from "./helpers"

function renderScoreBlock(value: unknown, t: Translator<EvaluationDictionary>): ReactNode {
  if (Array.isArray(value) && value.length > 0 && isPlainRecord(value[0])) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden">
        {value.map((item, idx) => {
          if (!isPlainRecord(item)) return null
          return (
            <div key={idx} className="flex flex-col gap-1 overflow-hidden rounded-md border p-2">
              {Object.entries(item).map(([ik, iv]) => (
                <div key={ik} className="grid grid-cols-[1fr_1fr] items-center gap-2 text-sm">
                  <span className="truncate text-muted-foreground">
                    {resolvePreviewKeyLabel(ik, t)}
                  </span>
                  <span className="truncate text-right font-medium">{renderPreviewValue(iv)}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }
  return <span className="truncate font-medium">{renderPreviewValue(value)}</span>
}

export interface EvaluationPageInject {
  readonly hooks: {
    readonly types: ObservableSource<QuerySnapshot<EvaluationType[]>>
    readonly selectedType: ObservableSource<string | null>
    readonly tasks: ObservableSource<QuerySnapshot<EvaluationTask[]>>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly selectType: (code: string) => Promise<void>
  readonly fetchDetail: (query: EvaluationDetailQuery) => Promise<EvaluationDetail>
  readonly calculateScore: (input: EvaluationScoreInput) => Promise<Record<string, unknown> | null>
  readonly submitEvaluation: (input: EvaluationSubmitInput) => Promise<void>
}

export type EvaluationPageProps = DerivedComponentProps<
  Record<string, never>,
  EvaluationDictionary,
  undefined,
  EvaluationViewStoreInstance,
  EvaluationPageInject
>

export const EvaluationPage: SlotComponent<EvaluationPageProps> = (props) => {
  const { t, useStore, actions } = props
  const typesQuery = props.useTypes()
  const selectedType = props.useSelectedType()
  const tasksQuery = props.useTasks()
  const canCalculateScore = props.useProvider((snap) =>
    Boolean(snap.provider?.slices.evaluation?.calculateEvaluationScore)
  )

  const [detail, setDetail] = useState<EvaluationDetail | null>(null)
  const [selectedTask, setSelectedTask] = useState<EvaluationTask | null>(null)
  const [answers, setAnswers] = useState<Record<string, EvaluationAnswer>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Batch dialog states
  const batchSelectOpen = useStore((state) => state.batchSelectOpen)
  const selectedTaskIds = useStore((state) => state.selectedTaskIds)
  const batchTextAnswer = useStore((state) => state.batchTextAnswer)
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false)
  const [batchProgressOpen, setBatchProgressOpen] = useState(false)
  const [batchTasks, setBatchTasks] = useState<BatchTaskResult[]>([])
  const [batchCurrentIdx, setBatchCurrentIdx] = useState(0)
  const [batchPhase, setBatchPhase] = useState<"fill" | "submit">("fill")
  const [batchDetailIdx, setBatchDetailIdx] = useState<number | null>(null)
  const abortRef = useRef(false)

  const types = useMemo(() => typesQuery.data ?? [], [typesQuery.data])
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data])
  const loadingTypes = typesQuery.isLoading && types.length === 0
  const loadingTasks = (tasksQuery.isLoading || tasksQuery.isRefreshing) && tasks.length === 0

  useErrorToast(typesQuery.error ?? undefined, t("updating"))
  useErrorToast(tasksQuery.error ?? undefined, t("updating"))

  const handleOpenTask = async (task: EvaluationTask): Promise<void> => {
    const status = getTaskStatus(task, t)
    if (!status.active) {
      toast.error(`${t("evaluation.cannotAnswer")} (${status.label})`)
      return
    }
    setSelectedTask(task)
    setLoadingDetail(true)
    setDialogOpen(true)
    setAnswers({})
    try {
      const loaded = await props.fetchDetail({
        groupNo: task.groupNo || "",
        evalType: task.evalType || "",
        sequence: task.sequence,
      })
      setDetail(loaded)
      setAnswers(createInitialAnswers(loaded))
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : t("updating")
      toast.error(message)
      setDialogOpen(false)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleAnswerChange = (question: Question, value: EvaluationAnswer): void => {
    setAnswers((prev) => ({ ...prev, [question.tmid]: value }))
  }

  const buildAnswers = (): EvaluationAnswer[] => Object.values(answers)

  const applyAutoFill = (): void => {
    const { answers: next, skipped } = autoFillMaxScore(detail, answers)
    setAnswers(next)
    if (skipped.length > 0) {
      const names = skipped.map((q) => `${q.order}. ${q.text || ""}`).join("\n")
      toast.warning(`${t("evaluation.autoFillSkipped", { count: skipped.length })}\n${names}`)
    } else {
      toast.success(t("evaluation.fillSuccess"))
    }
  }

  const handlePreview = async (): Promise<void> => {
    const validationError = validateAnswers(detail, answers, t)
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (!selectedTask || !detail) return
    setSubmitting(true)
    try {
      const res = await props.calculateScore({
        groupNo: selectedTask.groupNo || "",
        wjid: selectedTask.wjid || detail.wjid || "",
        evalType: selectedTask.evalType || "",
        answers: buildAnswers(),
        teacherRelationId: getTeacherRelationId(selectedTask, detail),
        courseName: selectedTask.courseName || "",
        teacherName: selectedTask.teacherName || "",
        sequence: Number(selectedTask.sequence),
      })
      if (res) {
        setPreviewResult(res)
        setPreviewOpen(true)
      }
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : t("updating")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    const validationError = validateAnswers(detail, answers, t)
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (!selectedTask || !detail) return
    setSubmitting(true)
    try {
      await props.submitEvaluation({
        groupNo: selectedTask.groupNo || "",
        wjid: selectedTask.wjid || detail.wjid || "",
        evalType: selectedTask.evalType || "",
        answers: buildAnswers(),
        teacherRelationId: getTeacherRelationId(selectedTask, detail),
        courseName: selectedTask.courseName || "",
        teacherName: selectedTask.teacherName || "",
        sequence: Number(selectedTask.sequence),
      })
      toast.success(t("evaluation.submit"))
      setDialogOpen(false)
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : t("updating")
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  function openBatchSelect(): void {
    const activeTasks = tasks.filter((task) => getTaskStatus(task, t).active)
    if (activeTasks.length === 0) {
      toast.error(t("evaluation.noActiveTasks"))
      return
    }
    actions.openBatchSelect()
  }

  const toggleTaskSelection = (taskId: string): void => {
    actions.toggleTaskSelection(taskId)
  }

  const selectAllTasks = (): void => {
    const activeTasks = tasks.filter((task) => getTaskStatus(task, t).active)
    actions.selectTasks(activeTasks.map((task) => task.wid || "").filter(Boolean))
  }

  const deselectAllTasks = (): void => {
    actions.selectTasks([])
  }

  const runBatchFill = async (
    initialResults: BatchTaskResult[],
    textAnswer: string
  ): Promise<void> => {
    const results = [...initialResults]
    for (let i = 0; i < results.length; i++) {
      if (abortRef.current) break
      const current = results[i]
      if (!current) continue
      setBatchCurrentIdx(i)
      results[i] = { ...current, status: "filling" }
      setBatchTasks([...results])
      try {
        const task = current.task
        const loadedDetail = await props.fetchDetail({
          groupNo: task.groupNo || "",
          evalType: task.evalType || "",
          sequence: task.sequence,
        })
        const initial = createInitialAnswers(loadedDetail)
        const { answers: filled, skipped } = autoFillMaxScore(loadedDetail, initial, textAnswer)
        if (skipped.length > 0) {
          const names = skipped.map((q) => `${q.order}. ${q.text || ""}`).join("\n")
          results[i] = {
            ...results[i]!,
            detail: loadedDetail,
            answers: filled,
            status: "failed",
            error: `${t("evaluation.autoFillSkipped", { count: skipped.length })}\n${names}`,
          }
          setBatchTasks([...results])
          continue
        }
        const validationError = validateAnswers(loadedDetail, filled, t)
        if (validationError) {
          results[i] = {
            ...results[i]!,
            detail: loadedDetail,
            answers: filled,
            status: "failed",
            error: validationError,
          }
          setBatchTasks([...results])
          continue
        }
        const scoreRes = await props.calculateScore({
          groupNo: task.groupNo || "",
          wjid: task.wjid || loadedDetail.wjid || "",
          evalType: task.evalType || "",
          answers: Object.values(filled),
          teacherRelationId: getTeacherRelationId(task, loadedDetail),
          courseName: task.courseName || "",
          teacherName: task.teacherName || "",
          sequence: Number(task.sequence),
        })
        results[i] = {
          ...results[i]!,
          detail: loadedDetail,
          answers: filled,
          scoreResult: scoreRes,
          status: "filled",
        }
        setBatchTasks([...results])
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t("updating")
        results[i] = {
          ...results[i]!,
          status: "failed",
          error: message,
        }
        setBatchTasks([...results])
      }
    }
    setBatchCurrentIdx(results.length)
    if (!abortRef.current) {
      setBatchProgressOpen(false)
      setBatchDetailIdx(null)
      setBatchPreviewOpen(true)
    }
  }

  const goToBatchPreview = (): void => {
    if (selectedTaskIds.size === 0) {
      toast.error(t("evaluation.noActiveTasks"))
      return
    }
    actions.setBatchSelectOpen(false)
    const tasksToProcess = tasks.filter(
      (task) => selectedTaskIds.has(task.wid || "") && getTaskStatus(task, t).active
    )
    const initialResults: BatchTaskResult[] = tasksToProcess.map((task) => ({
      task,
      detail: { questions: [] },
      answers: {},
      scoreResult: null,
      status: "pending",
    }))
    setBatchTasks(initialResults)
    setBatchCurrentIdx(0)
    setBatchPhase("fill")
    abortRef.current = false
    setBatchProgressOpen(true)
    void runBatchFill(initialResults, batchTextAnswer)
  }

  const runBatchSubmit = async (): Promise<void> => {
    const toSubmit = batchTasks.filter((r) => r.status === "filled")
    if (toSubmit.length === 0) {
      toast.error(t("evaluation.batchNoResults"))
      return
    }
    setBatchPreviewOpen(false)
    setBatchCurrentIdx(0)
    setBatchPhase("submit")
    abortRef.current = false
    setBatchProgressOpen(true)
    const results = [...batchTasks]
    for (let i = 0; i < results.length; i++) {
      if (abortRef.current) break
      const current = results[i]
      if (!current || current.status !== "filled") continue
      setBatchCurrentIdx(i)
      results[i] = { ...current, status: "submitting" }
      setBatchTasks([...results])
      try {
        const task = current.task
        const d = current.detail
        await props.submitEvaluation({
          groupNo: task.groupNo || "",
          wjid: task.wjid || d.wjid || "",
          evalType: task.evalType || "",
          answers: Object.values(current.answers),
          teacherRelationId: getTeacherRelationId(task, d),
          courseName: task.courseName || "",
          teacherName: task.teacherName || "",
          sequence: Number(task.sequence),
        })
        results[i] = { ...results[i]!, status: "submitted" }
        setBatchTasks([...results])
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t("updating")
        results[i] = {
          ...results[i]!,
          status: "failed",
          error: message,
        }
        setBatchTasks([...results])
      }
    }
    setBatchCurrentIdx(results.length)
    setBatchProgressOpen(false)
    const success = results.filter((r) => r.status === "submitted").length
    const failed = results.filter((r) => r.status === "failed").length
    toast.success(t("evaluation.batchSuccess", { success, failed }))
  }

  const abortBatch = (): void => {
    abortRef.current = true
    setBatchProgressOpen(false)
    toast.info(t("evaluation.cancel"))
  }

  const hasBatchTasks = Boolean(selectedType) && tasks.some((task) => getTaskStatus(task, t).active)

  if (loadingTypes) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="hidden md:block">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("evaluation.title")}</CardTitle>
              <CardDescription>{t("evaluation.description")}</CardDescription>
            </div>
            {hasBatchTasks && (
              <Button variant="outline" size="sm" onClick={openBatchSelect}>
                <Sparkles data-icon="inline-start" />
                {t("evaluation.batchAuto")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {types.map((type) => (
              <Button
                key={type.code ?? type.name}
                data-evaluation-type={type.code ?? ""}
                variant={selectedType === type.code ? "default" : "outline"}
                onClick={() => void props.selectType(type.code || "")}
              >
                {type.name}
                {type.count > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {type.count}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedType && (
        <Card>
          <CardHeader>
            <CardTitle>{t("evaluation.pendingTasks")}</CardTitle>
            <CardDescription>
              {types.find((type) => type.code === selectedType)?.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTasks ? (
              <Skeleton className="h-48" />
            ) : tasks.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ClipboardCheck />
                  </EmptyMedia>
                  <EmptyTitle>{t("evaluation.noTasks")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {tasks.map((task) => {
                  const status = getTaskStatus(task, t)
                  return (
                    <Card
                      key={task.wid}
                      data-evaluation-task={task.wid}
                      className={
                        status.active
                          ? "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                          : "opacity-60"
                      }
                      onClick={() => void handleOpenTask(task)}
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="truncate text-base">{task.courseName}</CardTitle>
                        <CardDescription className="truncate">{task.teacherName}</CardDescription>
                        <CardAction>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                        <span className="truncate">
                          {task.termName} · {task.className}
                        </span>
                        {task.startTime && task.endTime && (
                          <span className="truncate text-xs">
                            {t("evaluation.dateRange", {
                              start: task.startTime,
                              end: task.endTime,
                            })}
                          </span>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Single evaluation rubric dialog */}
      <ResponsiveModal open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveModalContent className="max-h-[90vh] w-[90vw] overflow-auto sm:max-w-5xl">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{detail?.name || t("evaluation.title")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {selectedTask?.courseName} - {selectedTask?.teacherName}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          <ResponsiveModalBody>
            {loadingDetail ? (
              <div className="flex flex-col gap-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-32" />
                <Skeleton className="h-32" />
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    data-evaluation-autofill=""
                    onClick={applyAutoFill}
                  >
                    <Sparkles data-icon="inline-start" />
                    {t("evaluation.autoFill")}
                  </Button>
                </div>

                {detail?.questions.map((question) => (
                  <div key={question.tmid} className="flex flex-col gap-3">
                    <div className="font-medium">
                      {question.order}. {question.text}
                      {question.maxScore > 0 && (
                        <span className="ml-2 text-sm text-muted-foreground">
                          ({question.maxScore})
                        </span>
                      )}
                    </div>
                    {question.questionType === "01" && question.options.length > 0 && (
                      <RadioGroup
                        value={answers[question.tmid]?.optionIds?.[0] || ""}
                        onValueChange={(val) =>
                          handleAnswerChange(question, {
                            tmid: question.tmid,
                            questionType: question.questionType || "",
                            optionIds: [val],
                            text: "",
                          })
                        }
                      >
                        <div className="flex flex-col gap-2">
                          {question.options.map((opt) => (
                            <div key={opt.wid} className="flex items-center gap-2">
                              <RadioGroupItem value={opt.wid} id={`${question.tmid}-${opt.wid}`} />
                              <Label htmlFor={`${question.tmid}-${opt.wid}`}>
                                {opt.text}
                                {opt.score > 0 && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    ({opt.score})
                                  </span>
                                )}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </RadioGroup>
                    )}
                    {question.questionType === "07" && question.options.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {question.options.map((opt) => {
                          const selected =
                            answers[question.tmid]?.optionIds?.includes(opt.wid) || false
                          return (
                            <div key={opt.wid} className="flex items-center gap-2">
                              <Checkbox
                                id={`${question.tmid}-${opt.wid}`}
                                checked={selected}
                                onCheckedChange={(checked) => {
                                  const current = answers[question.tmid]?.optionIds || []
                                  const next = checked
                                    ? [...current, opt.wid]
                                    : current.filter((id) => id !== opt.wid)
                                  handleAnswerChange(question, {
                                    tmid: question.tmid,
                                    questionType: question.questionType || "",
                                    optionIds: next,
                                    text: "",
                                  })
                                }}
                              />
                              <Label htmlFor={`${question.tmid}-${opt.wid}`}>
                                {opt.text}
                                {opt.score > 0 && (
                                  <span className="ml-1 text-xs text-muted-foreground">
                                    ({opt.score})
                                  </span>
                                )}
                              </Label>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {question.questionType !== "01" && question.questionType !== "07" && (
                      <Textarea
                        name={`evaluation-text-${question.tmid}`}
                        placeholder={t("evaluation.textPlaceholder")}
                        value={answers[question.tmid]?.text || ""}
                        onChange={(e) =>
                          handleAnswerChange(question, {
                            tmid: question.tmid,
                            questionType: question.questionType || "",
                            optionIds: [],
                            text: e.target.value,
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ResponsiveModalBody>

          <ResponsiveModalFooter className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            {canCalculateScore && (
              <Button
                variant="secondary"
                data-evaluation-preview=""
                onClick={() => void handlePreview()}
                disabled={submitting || loadingDetail}
              >
                {submitting && <Spinner data-icon="inline-start" />}
                {submitting ? t("evaluation.previewing") : t("evaluation.preview")}
              </Button>
            )}
            <Button
              data-evaluation-submit=""
              onClick={() => void handleSubmit()}
              disabled={submitting || loadingDetail}
            >
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting ? t("evaluation.submitting") : t("evaluation.submit")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Score preview dialog */}
      <ResponsiveModal open={previewOpen} onOpenChange={setPreviewOpen}>
        <ResponsiveModalContent className="overflow-hidden sm:max-w-xl">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.previewResult")}</ResponsiveModalTitle>
            <ResponsiveModalDescription className="sr-only">
              {t("evaluation.previewResultDesc")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-3 text-sm">
            {previewResult &&
              Object.entries(previewResult).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {resolvePreviewKeyLabel(k, t)}
                  </span>
                  {renderScoreBlock(v, t)}
                </div>
              ))}
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button onClick={() => setPreviewOpen(false)}>{t("evaluation.close")}</Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Batch selection dialog */}
      <ResponsiveModal open={batchSelectOpen} onOpenChange={actions.setBatchSelectOpen}>
        <ResponsiveModalContent className="sm:max-w-2xl">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.batchSelectTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {t("evaluation.batchSelectDesc")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="batch-text-answer">
                {t("evaluation.batchTextAnswerLabel")}
              </FieldLabel>
              <Input
                id="batch-text-answer"
                value={batchTextAnswer}
                onChange={(e) => actions.setBatchTextAnswer(e.target.value)}
                placeholder={t("evaluation.batchTextAnswerPlaceholder")}
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={selectAllTasks}>
                {t("evaluation.selectAll")}
              </Button>
              <Button variant="outline" size="sm" onClick={deselectAllTasks}>
                {t("evaluation.deselectAll")}
              </Button>
              <span className="ml-auto text-sm text-muted-foreground">
                {t("evaluation.selectedCount", { count: selectedTaskIds.size })}
              </span>
            </div>
            <div className="flex flex-col gap-2 md:max-h-[50vh] md:overflow-auto">
              {tasks
                .filter((task) => getTaskStatus(task, t).active)
                .map((task) => (
                  <div
                    key={task.wid}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/50"
                    onClick={() => toggleTaskSelection(task.wid || "")}
                  >
                    <Checkbox
                      checked={selectedTaskIds.has(task.wid || "")}
                      onCheckedChange={() => toggleTaskSelection(task.wid || "")}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{task.courseName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {task.teacherName} · {task.termName}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => actions.setBatchSelectOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button onClick={goToBatchPreview} disabled={selectedTaskIds.size === 0}>
              {t("evaluation.nextStep")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Batch progress dialog */}
      <ResponsiveModal
        open={batchProgressOpen}
        onOpenChange={(open) => {
          if (!open) abortBatch()
        }}
      >
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.batchProgressTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {batchPhase === "fill"
                ? t("evaluation.batchPhaseFill")
                : t("evaluation.batchPhaseSubmit")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-4">
            <Progress
              value={batchTasks.length > 0 ? ((batchCurrentIdx + 1) / batchTasks.length) * 100 : 0}
            />
            <div className="text-sm text-muted-foreground">
              {batchCurrentIdx < batchTasks.length
                ? `${batchCurrentIdx + 1} / ${batchTasks.length} · ${batchTasks[batchCurrentIdx]?.task.courseName || ""}`
                : t("evaluation.batchSuccess", {
                    success: batchTasks.filter((r) => r.status === "submitted").length,
                    failed: batchTasks.filter((r) => r.status === "failed").length,
                  })}
            </div>
            <div className="flex flex-col gap-2 md:max-h-[40vh] md:overflow-auto">
              {batchTasks.map((r, idx) => {
                const statusMap = {
                  pending: {
                    label: t("evaluation.batchTaskStatusPending"),
                    color: "text-muted-foreground",
                  },
                  filling: {
                    label: t("evaluation.batchTaskStatusProcessing"),
                    color: "text-primary",
                  },
                  filled: {
                    label: t("evaluation.batchTaskStatusSuccess"),
                    color: "text-primary",
                  },
                  submitting: {
                    label: t("evaluation.batchTaskStatusProcessing"),
                    color: "text-primary",
                  },
                  submitted: {
                    label: t("evaluation.batchTaskStatusSuccess"),
                    color: "text-primary",
                  },
                  failed: {
                    label: t("evaluation.batchTaskStatusFailed"),
                    color: "text-destructive",
                  },
                }
                const s = statusMap[r.status]
                return (
                  <div
                    key={`${r.task.wid}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">{r.task.courseName}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {r.task.teacherName}
                      </span>
                    </div>
                    <span className={`shrink-0 text-xs ${s.color}`}>{s.label}</span>
                  </div>
                )
              })}
            </div>
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button variant="destructive" onClick={abortBatch}>
              {t("evaluation.batchAbort")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Batch preview dialog */}
      <ResponsiveModal
        open={batchPreviewOpen}
        onOpenChange={(open) => {
          if (!open && batchDetailIdx !== null) {
            setBatchDetailIdx(null)
            return
          }
          setBatchPreviewOpen(open)
          if (!open) setBatchDetailIdx(null)
        }}
      >
        <ResponsiveModalContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-3xl">
          <div
            key={batchDetailIdx === null ? "list" : "detail"}
            className="flex min-h-0 flex-1 animate-in flex-col duration-200 fade-in-50"
          >
            {batchDetailIdx === null ? (
              <>
                <ResponsiveModalHeader>
                  <ResponsiveModalTitle>{t("evaluation.batchPreviewTitle")}</ResponsiveModalTitle>
                  <ResponsiveModalDescription>
                    {t("evaluation.batchPreviewDesc")}
                  </ResponsiveModalDescription>
                </ResponsiveModalHeader>
                <ResponsiveModalBody className="min-h-0 flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-2 px-0.5 py-1 md:gap-3 md:px-2 md:pb-2">
                    {batchTasks.map((r, idx) => (
                      <Card
                        key={`${r.task.wid}-${idx}`}
                        className={cn(
                          "cursor-pointer py-3 transition-colors hover:bg-muted/40 md:py-4",
                          r.status === "failed" && "opacity-60"
                        )}
                        onClick={() => setBatchDetailIdx(idx)}
                      >
                        <CardHeader className="py-0 md:py-0">
                          <CardTitle className="truncate text-base">{r.task.courseName}</CardTitle>
                          <CardDescription className="truncate">
                            {r.task.teacherName}
                          </CardDescription>
                          <CardAction className="self-center">
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant={
                                  r.status === "filled"
                                    ? "default"
                                    : r.status === "failed"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {r.status === "filled"
                                  ? t("evaluation.batchTaskStatusSuccess")
                                  : r.status === "failed"
                                    ? t("evaluation.batchTaskStatusFailed")
                                    : t("evaluation.batchTaskStatusPending")}
                              </Badge>
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </div>
                          </CardAction>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </ResponsiveModalBody>
                <ResponsiveModalFooter className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" onClick={() => setBatchPreviewOpen(false)}>
                    {t("evaluation.cancel")}
                  </Button>
                  <Button
                    onClick={() => void runBatchSubmit()}
                    disabled={batchTasks.filter((r) => r.status === "filled").length === 0}
                  >
                    {t("evaluation.batchContinue")}
                  </Button>
                </ResponsiveModalFooter>
              </>
            ) : (
              (() => {
                const r = batchTasks[batchDetailIdx]
                if (!r) return null
                return (
                  <>
                    <ResponsiveModalHeader>
                      <ResponsiveModalTitle className="truncate">
                        {r.task.courseName}
                      </ResponsiveModalTitle>
                      <ResponsiveModalDescription className="truncate">
                        {r.task.teacherName}
                      </ResponsiveModalDescription>
                    </ResponsiveModalHeader>
                    <ResponsiveModalBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto text-sm">
                      {r.status === "filled" && r.scoreResult && (
                        <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                          {Object.entries(r.scoreResult).map(([k, v]) => (
                            <div key={k} className="flex flex-col gap-1">
                              <span className="text-xs text-muted-foreground">
                                {resolvePreviewKeyLabel(k, t)}
                              </span>
                              {renderScoreBlock(v, t)}
                            </div>
                          ))}
                        </div>
                      )}
                      {r.status === "filled" && r.detail.questions.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {t("evaluation.batchAnswers")}
                          </span>
                          <div className="flex flex-col divide-y divide-border">
                            {formatAnswerPreview(r.detail, r.answers).map((item) => (
                              <div key={item.order} className="flex flex-col gap-1 py-2">
                                <span className="text-muted-foreground" title={item.text}>
                                  {item.order}. {item.text}
                                </span>
                                <span className="font-medium" title={item.answer}>
                                  {item.answer}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {r.status === "failed" && r.error && (
                        <div className="text-destructive">{r.error}</div>
                      )}
                    </ResponsiveModalBody>
                    <ResponsiveModalFooter>
                      <Button onClick={() => setBatchDetailIdx(null)} className="w-full">
                        {t("evaluation.close")}
                      </Button>
                    </ResponsiveModalFooter>
                  </>
                )
              })()
            )}
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}
