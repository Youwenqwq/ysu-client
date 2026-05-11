"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalBody,
} from "@/components/responsive-modal";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMobileHeaderRight } from "@/lib/mobile-header-store";
import { cn } from "@/lib/utils";
import {
  getEvaluationTypes,
  getPendingEvaluations,
  getEvaluationDetail,
  calculateScore,
  submitEvaluation,
} from "@/lib/api";
import type {
  EvaluationType,
  EvaluationTask,
  EvaluationDetail,
  Question,
  EvaluationAnswer,
} from "@/lib/types";
import { ChevronDown, ChevronRight, ClipboardCheck, Sparkles } from "lucide-react";

interface BatchTaskResult {
  task: EvaluationTask;
  detail: EvaluationDetail;
  answers: Record<string, EvaluationAnswer>;
  scoreResult: Record<string, unknown> | null;
  status: "pending" | "filling" | "filled" | "submitting" | "submitted" | "failed";
  error?: string;
}

function renderPreviewValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(renderPreviewValue).join(", ")}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function renderScoreBlock(
  k: string,
  v: unknown,
  t: ReturnType<typeof useTranslation>["t"],
): React.ReactNode {
  if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null) {
    return (
      <div className="flex flex-col gap-2 overflow-hidden">
        {v.map((item, idx) => {
          const obj = item as Record<string, unknown>;
          return (
            <div key={idx} className="rounded-md border p-2 flex flex-col gap-1 overflow-hidden">
              {Object.entries(obj).map(([ik, iv]) => (
                <div key={ik} className="grid grid-cols-[1fr_1fr] gap-2 text-sm items-center">
                  <span className="text-muted-foreground truncate">{t(`evaluation.previewKeys.${ik}` as never) || ik}</span>
                  <span className="font-medium truncate text-right">{renderPreviewValue(iv)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }
  return <span className="font-medium truncate">{renderPreviewValue(v)}</span>;
}

function formatAnswerPreview(
  detail: EvaluationDetail,
  answers: Record<string, EvaluationAnswer>,
): { order: number; text: string; answer: string }[] {
  return detail.questions.map((q) => {
    const a = answers[q.tmid];
    let answer = "";
    if (!a) {
      answer = "-";
    } else if (q.question_type === "01") {
      const opt = q.options.find((o) => a.option_ids?.includes(o.wid));
      answer = opt ? `${opt.text} (${opt.score})` : "-";
    } else if (q.question_type === "07") {
      const opts = q.options.filter((o) => a.option_ids?.includes(o.wid));
      answer = opts.length > 0 ? opts.map((o) => `${o.text} (${o.score})`).join(", ") : "-";
    } else {
      answer = a.text || "-";
    }
    return { order: q.order, text: q.text || "", answer };
  });
}

function getTeacherRelationId(task: EvaluationTask, detail: EvaluationDetail): string {
  return (detail.teachers?.[0] as Record<string, unknown> | undefined)?.PJGXID as string | undefined || task.teacher_id || "";
}

function getTaskStatus(task: EvaluationTask, t: ReturnType<typeof useTranslation>["t"]): { active: boolean; label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  const now = new Date();
  if (task.start_time) {
    const start = new Date(task.start_time.replace(" ", "T"));
    if (now < start) return { active: false, label: t("evaluation.statusNotStarted"), variant: "secondary" };
  }
  if (task.end_time) {
    const end = new Date(task.end_time.replace(" ", "T"));
    if (now > end) return { active: false, label: t("evaluation.statusEnded"), variant: "destructive" };
  }
  return { active: true, label: t("evaluation.statusActive"), variant: "default" };
}

export default function EvaluationPage() {
  const credential = useAuthStore((s) => s.credential);
  const { t } = useTranslation();
  const [types, setTypes] = useState<EvaluationType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [tasks, setTasks] = useState<EvaluationTask[]>([]);
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [selectedTask, setSelectedTask] = useState<EvaluationTask | null>(null);
  const [answers, setAnswers] = useState<Record<string, EvaluationAnswer>>({});
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<Record<string, unknown> | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Batch dialog states
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [batchPreviewOpen, setBatchPreviewOpen] = useState(false);
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [batchTasks, setBatchTasks] = useState<BatchTaskResult[]>([]);
  const [batchCurrentIdx, setBatchCurrentIdx] = useState(0);
  const [batchPhase, setBatchPhase] = useState<"fill" | "submit">("fill");
  const [batchDetailIdx, setBatchDetailIdx] = useState<number | null>(null);
  const [batchTextAnswer, setBatchTextAnswer] = useState("");
  const abortRef = useRef(false);



  useEffect(() => {
    if (!credential) return;
    async function load() {
      try {
        const fetched = await getEvaluationTypes(credential!);
        setTypes(fetched);
      } catch (err) {
        toast.error((err as Error).message || t("app.updating"));
      } finally {
        setLoadingTypes(false);
      }
    }
    load();
  }, [credential, t]);

  useEffect(() => {
    if (selectedType || types.length === 0 || !types[0].code) return;
    handleSelectType(types[0].code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, selectedType]);

  async function refreshTypes() {
    if (!credential) return;
    try {
      const updated = await getEvaluationTypes(credential);
      setTypes(updated);
    } catch {
      // silent: refresh is best-effort
    }
  }

  async function handleSelectType(code: string) {
    if (!credential) return;
    setSelectedType(code);
    setLoadingTasks(true);
    try {
      const fetched = await getPendingEvaluations(credential, code);
      setTasks(fetched);
    } catch (err) {
      toast.error((err as Error).message || t("app.updating"));
    } finally {
      setLoadingTasks(false);
    }
  }

  async function handleOpenTask(task: EvaluationTask) {
    const status = getTaskStatus(task, t);
    if (!status.active) {
      toast.error(`${t("evaluation.cannotAnswer")} (${status.label})`);
      return;
    }
    if (!credential) return;
    setSelectedTask(task);
    setLoadingDetail(true);
    setDialogOpen(true);
    setAnswers({});
    try {
      const d = await getEvaluationDetail(credential, task.group_no || "", task.eval_type || "", task.sequence);
      setDetail(d);
      const initial: Record<string, EvaluationAnswer> = {};
      for (const q of d.questions) {
        initial[q.tmid] = {
          tmid: q.tmid,
          question_type: q.question_type || "",
          option_ids: [],
          text: "",
        };
      }
      setAnswers(initial);
    } catch (err) {
      toast.error((err as Error).message || t("app.updating"));
      setDialogOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  }

  function handleAnswerChange(q: Question, value: EvaluationAnswer) {
    setAnswers((prev) => ({ ...prev, [q.tmid]: value }));
  }

  function buildAnswers(): EvaluationAnswer[] {
    return Object.values(answers);
  }

  function autoFillMaxScore(targetAnswers?: Record<string, EvaluationAnswer>, targetDetail?: EvaluationDetail | null, textAnswer?: string): Record<string, EvaluationAnswer> {
    const d = targetDetail || detail;
    if (!d) return {};
    const next: Record<string, EvaluationAnswer> = targetAnswers ? { ...targetAnswers } : { ...answers };
    const text = textAnswer?.trim() || "优秀";
    for (const q of d.questions) {
      if (q.question_type === "01") {
        const best = q.options.length > 0
          ? [...q.options].sort((a, b) => b.score - a.score)[0]
          : null;
        next[q.tmid] = {
          tmid: q.tmid,
          question_type: q.question_type || "",
          option_ids: best ? [best.wid] : [],
          text: "",
        };
      } else if (q.question_type === "07") {
        const positive = q.options.filter((o) => o.score > 0);
        const toSelect = positive.length > 0 ? positive : q.options;
        next[q.tmid] = {
          tmid: q.tmid,
          question_type: q.question_type || "",
          option_ids: toSelect.map((o) => o.wid),
          text: "",
        };
      } else {
        next[q.tmid] = {
          tmid: q.tmid,
          question_type: q.question_type || "",
          option_ids: [],
          text,
        };
      }
    }
    return next;
  }

  function applyAutoFill() {
    const next = autoFillMaxScore();
    setAnswers(next);
    toast.success(t("evaluation.fillSuccess"));
  }

  function validateAnswers(targetAnswers?: Record<string, EvaluationAnswer>, targetDetail?: EvaluationDetail | null): string | null {
    const d = targetDetail || detail;
    const ans = targetAnswers || answers;
    if (!d) return t("evaluation.validation.notLoaded");
    for (const q of d.questions) {
      const a = ans[q.tmid];
      if (!a) return t("evaluation.validation.unanswered", { order: q.order });
      if (q.question_type === "01" && (!a.option_ids || a.option_ids.length === 0)) {
        return t("evaluation.validation.singleChoice", { order: q.order });
      }
      if (q.question_type === "07" && (!a.option_ids || a.option_ids.length === 0)) {
        return t("evaluation.validation.multiChoice", { order: q.order });
      }
      if (q.question_type !== "01" && q.question_type !== "07" && !a.text?.trim()) {
        return t("evaluation.validation.text", { order: q.order });
      }
    }
    return null;
  }

  async function handlePreview() {
    const err = validateAnswers();
    if (err) {
      toast.error(err);
      return;
    }
    if (!credential || !selectedTask || !detail) return;
    setSubmitting(true);
    try {
      const res = await calculateScore(credential, {
        group_no: selectedTask.group_no || "",
        wjid: selectedTask.wjid || detail.wjid || "",
        eval_type: selectedTask.eval_type || "",
        answers: buildAnswers(),
        teacher_relation_id: getTeacherRelationId(selectedTask, detail),
        course_name: selectedTask.course_name || "",
        teacher_name: selectedTask.teacher_name || "",
        sequence: Number(selectedTask.sequence),
      });
      setPreviewResult(res);
      setPreviewOpen(true);
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      toast.error(e.message || t("app.updating"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    const err = validateAnswers();
    if (err) {
      toast.error(err);
      return;
    }
    if (!credential || !selectedTask || !detail) return;
    setSubmitting(true);
    try {
      await submitEvaluation(credential, {
        group_no: selectedTask.group_no || "",
        wjid: selectedTask.wjid || detail.wjid || "",
        eval_type: selectedTask.eval_type || "",
        answers: buildAnswers(),
        teacher_relation_id: getTeacherRelationId(selectedTask, detail),
        course_name: selectedTask.course_name || "",
        teacher_name: selectedTask.teacher_name || "",
        sequence: Number(selectedTask.sequence),
      });
      toast.success(t("evaluation.submit"));
      setDialogOpen(false);
      refreshTypes();
      if (selectedType) {
        handleSelectType(selectedType);
      }
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      toast.error(e.message || t("app.updating"));
    } finally {
      setSubmitting(false);
    }
  }

  // Batch auto-fill with selection dialog
  function openBatchSelect() {
    const activeTasks = tasks.filter((task) => getTaskStatus(task, t).active);
    if (activeTasks.length === 0) {
      toast.error(t("evaluation.noActiveTasks"));
      return;
    }
    setSelectedTaskIds(new Set());
    setBatchTextAnswer("");
    setBatchSelectOpen(true);
  }

  function toggleTaskSelection(taskId: string) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function selectAllTasks() {
    const activeTasks = tasks.filter((task) => getTaskStatus(task, t).active);
    setSelectedTaskIds(new Set(activeTasks.map((task) => task.wid || "").filter(Boolean)));
  }

  function deselectAllTasks() {
    setSelectedTaskIds(new Set());
  }

  function goToBatchPreview() {
    if (selectedTaskIds.size === 0) {
      toast.error(t("evaluation.noActiveTasks"));
      return;
    }
    setBatchSelectOpen(false);
    const tasksToProcess = tasks.filter(
      (task) => selectedTaskIds.has(task.wid || "") && getTaskStatus(task, t).active
    );
    const initialResults: BatchTaskResult[] = tasksToProcess.map((task) => ({
      task,
      detail: { questions: [] },
      answers: {},
      scoreResult: null,
      status: "pending",
    }));
    setBatchTasks(initialResults);
    setBatchCurrentIdx(0);
    setBatchPhase("fill");
    abortRef.current = false;
    setBatchProgressOpen(true);
    runBatchFill(initialResults, batchTextAnswer);
  }

  async function runBatchFill(initialResults: BatchTaskResult[], textAnswer: string) {
    if (!credential) return;
    const results = [...initialResults];
    for (let i = 0; i < results.length; i++) {
      if (abortRef.current) break;
      setBatchCurrentIdx(i);
      results[i] = { ...results[i], status: "filling" };
      setBatchTasks([...results]);
      try {
        const task = results[i].task;
        const d = await getEvaluationDetail(credential, task.group_no || "", task.eval_type || "", task.sequence);
        const initial: Record<string, EvaluationAnswer> = {};
        for (const q of d.questions) {
          initial[q.tmid] = {
            tmid: q.tmid,
            question_type: q.question_type || "",
            option_ids: [],
            text: "",
          };
        }
        const filled = autoFillMaxScore(initial, d, textAnswer);
        const err = validateAnswers(filled, d);
        if (err) {
          results[i] = { ...results[i], detail: d, answers: filled, status: "failed", error: err };
          setBatchTasks([...results]);
          continue;
        }
        const scoreRes = await calculateScore(credential, {
          group_no: task.group_no || "",
          wjid: task.wjid || d.wjid || "",
          eval_type: task.eval_type || "",
          answers: Object.values(filled),
          teacher_relation_id: getTeacherRelationId(task, d),
          course_name: task.course_name || "",
          teacher_name: task.teacher_name || "",
          sequence: Number(task.sequence),
        });
        results[i] = { ...results[i], detail: d, answers: filled, scoreResult: scoreRes, status: "filled" };
        setBatchTasks([...results]);
      } catch (err) {
        results[i] = { ...results[i], status: "failed", error: (err as Error).message };
        setBatchTasks([...results]);
      }
    }
    setBatchCurrentIdx(results.length);
    if (!abortRef.current) {
      setBatchProgressOpen(false);
      setBatchDetailIdx(null);
      setBatchPreviewOpen(true);
    }
  }

  async function runBatchSubmit() {
    if (!credential) return;
    const toSubmit = batchTasks.filter((r) => r.status === "filled");
    if (toSubmit.length === 0) {
      toast.error(t("evaluation.batchNoResults"));
      return;
    }
    setBatchPreviewOpen(false);
    setBatchCurrentIdx(0);
    setBatchPhase("submit");
    abortRef.current = false;
    setBatchProgressOpen(true);
    const results = [...batchTasks];
    for (let i = 0; i < results.length; i++) {
      if (abortRef.current) break;
      if (results[i].status !== "filled") continue;
      setBatchCurrentIdx(i);
      results[i] = { ...results[i], status: "submitting" };
      setBatchTasks([...results]);
      try {
        const task = results[i].task;
        const d = results[i].detail;
        await submitEvaluation(credential, {
          group_no: task.group_no || "",
          wjid: task.wjid || d.wjid || "",
          eval_type: task.eval_type || "",
          answers: Object.values(results[i].answers),
          teacher_relation_id: getTeacherRelationId(task, d),
          course_name: task.course_name || "",
          teacher_name: task.teacher_name || "",
          sequence: Number(task.sequence),
        });
        results[i] = { ...results[i], status: "submitted" };
        setBatchTasks([...results]);
      } catch (err) {
        results[i] = { ...results[i], status: "failed", error: (err as Error).message };
        setBatchTasks([...results]);
      }
    }
    setBatchCurrentIdx(results.length);
    setBatchProgressOpen(false);
    const success = results.filter((r) => r.status === "submitted").length;
    const failed = results.filter((r) => r.status === "failed").length;
    toast.success(t("evaluation.batchSuccess", { success, failed }));
    refreshTypes();
    if (selectedType) {
      handleSelectType(selectedType);
    }
  }

  function abortBatch() {
    abortRef.current = true;
    setBatchProgressOpen(false);
    toast.info(t("evaluation.cancel"));
  }

  const selectedTypeObj = types.find((typ) => typ.code === selectedType);
  const hasBatchTasks = !!selectedType && tasks.some((task) => getTaskStatus(task, t).active);

  useMobileHeaderRight(
    types.length > 0 ? (
      <div className="flex items-center gap-1">
        {hasBatchTasks && (
          <Button
            variant="ghost"
            size="sm"
            onClick={openBatchSelect}
            className="h-8 px-2"
            aria-label={t("evaluation.batchAuto")}
          >
            <Sparkles className="size-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-sm">
              <span className="max-w-[7rem] truncate">
                {selectedTypeObj?.name || t("evaluation.title")}
              </span>
              <ChevronDown className="ml-0.5 size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            {types.map((type) => (
              <DropdownMenuItem
                key={type.code}
                onSelect={() => handleSelectType(type.code || "")}
                className="flex items-center justify-between gap-3"
              >
                <span>{type.name}</span>
                {type.count > 0 && <Badge variant="secondary">{type.count}</Badge>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ) : null,
    [types, selectedType, selectedTypeObj, hasBatchTasks, t],
  );

  if (loadingTypes) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-48" />
      </div>
    );
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
            {selectedType && tasks.filter((task) => getTaskStatus(task, t).active).length > 0 && (
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
                key={type.code}
                variant={selectedType === type.code ? "default" : "outline"}
                onClick={() => handleSelectType(type.code || "")}
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
              {types.find((typ) => typ.code === selectedType)?.name}
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
                  <EmptyDescription>{t("evaluation.description")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {tasks.map((task) => {
                  const status = getTaskStatus(task, t);
                  return (
                    <Card
                      key={task.wid}
                      className={
                        status.active
                          ? "cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                          : "opacity-60"
                      }
                      onClick={() => handleOpenTask(task)}
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base truncate">{task.course_name}</CardTitle>
                        <CardDescription className="truncate">{task.teacher_name}</CardDescription>
                        <CardAction>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </CardAction>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                        <span className="truncate">{task.term_name} · {task.class_name}</span>
                        {task.start_time && task.end_time && (
                          <span className="truncate text-xs">{t("evaluation.dateRange", { start: task.start_time, end: task.end_time })}</span>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Main evaluation dialog - enlarged */}
      <ResponsiveModal open={dialogOpen} onOpenChange={setDialogOpen}>
        <ResponsiveModalContent className="sm:max-w-5xl w-[90vw] max-h-[90vh] overflow-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{detail?.name || t("evaluation.title")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {selectedTask?.course_name} - {selectedTask?.teacher_name}
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
                  <Button variant="outline" size="sm" onClick={applyAutoFill}>
                    <Sparkles data-icon="inline-start" />
                    {t("evaluation.autoFill")}
                  </Button>
                </div>

                {detail?.questions.map((q) => (
                  <div key={q.tmid} className="flex flex-col gap-3">
                    <div className="font-medium">
                      {q.order}. {q.text}
                      {q.max_score > 0 && (
                        <span className="text-sm text-muted-foreground ml-2">
                          ({q.max_score})
                        </span>
                      )}
                    </div>
                    {q.question_type === "01" && q.options.length > 0 && (
                      <RadioGroup
                        value={answers[q.tmid]?.option_ids?.[0] || ""}
                        onValueChange={(v) =>
                          handleAnswerChange(q, {
                            tmid: q.tmid,
                            question_type: q.question_type || "",
                            option_ids: [v],
                            text: "",
                          })
                        }
                      >
                        <div className="flex flex-col gap-2">
                          {q.options.map((opt) => (
                            <div key={opt.wid} className="flex items-center gap-2">
                              <RadioGroupItem value={opt.wid} id={`${q.tmid}-${opt.wid}`} />
                              <Label htmlFor={`${q.tmid}-${opt.wid}`}>
                                {opt.text}
                                {opt.score > 0 && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({opt.score})
                                  </span>
                                )}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </RadioGroup>
                    )}
                    {q.question_type === "07" && q.options.length > 0 && (
                      <div className="flex flex-col gap-2">
                        {q.options.map((opt) => {
                          const selected = answers[q.tmid]?.option_ids?.includes(opt.wid) || false;
                          return (
                            <div key={opt.wid} className="flex items-center gap-2">
                              <Checkbox
                                id={`${q.tmid}-${opt.wid}`}
                                checked={selected}
                                onCheckedChange={(checked) => {
                                  const current = answers[q.tmid]?.option_ids || [];
                                  const next = checked
                                    ? [...current, opt.wid]
                                    : current.filter((id) => id !== opt.wid);
                                  handleAnswerChange(q, {
                                    tmid: q.tmid,
                                    question_type: q.question_type || "",
                                    option_ids: next,
                                    text: "",
                                  });
                                }}
                              />
                              <Label htmlFor={`${q.tmid}-${opt.wid}`}>
                                {opt.text}
                                {opt.score > 0 && (
                                  <span className="text-xs text-muted-foreground ml-1">
                                    ({opt.score})
                                  </span>
                                )}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {q.question_type !== "01" && q.question_type !== "07" && (
                      <Textarea
                        placeholder={t("evaluation.textPlaceholder")}
                        value={answers[q.tmid]?.text || ""}
                        onChange={(e) =>
                          handleAnswerChange(q, {
                            tmid: q.tmid,
                            question_type: q.question_type || "",
                            option_ids: [],
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

          <ResponsiveModalFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button variant="secondary" onClick={handlePreview} disabled={submitting || loadingDetail}>
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting ? t("evaluation.previewing") : t("evaluation.preview")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || loadingDetail}>
              {submitting && <Spinner data-icon="inline-start" />}
              {submitting ? t("evaluation.submitting") : t("evaluation.submit")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Preview dialog */}
      <ResponsiveModal open={previewOpen} onOpenChange={setPreviewOpen}>
        <ResponsiveModalContent className="sm:max-w-xl overflow-hidden">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.previewResult")}</ResponsiveModalTitle>
            <ResponsiveModalDescription className="sr-only">
              {t("evaluation.previewResultDesc")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-3 text-sm">
            {previewResult && Object.entries(previewResult).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1.5">
                <span className="text-muted-foreground text-xs">{t(`evaluation.previewKeys.${k}` as never) || k}</span>
                {renderScoreBlock(k, v, t)}
              </div>
            ))}
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button onClick={() => setPreviewOpen(false)}>{t("evaluation.close")}</Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Batch selection dialog */}
      <ResponsiveModal open={batchSelectOpen} onOpenChange={setBatchSelectOpen}>
        <ResponsiveModalContent className="sm:max-w-2xl">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.batchSelectTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>{t("evaluation.batchSelectDesc")}</ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="batch-text-answer">{t("evaluation.batchTextAnswerLabel")}</FieldLabel>
              <Input
                id="batch-text-answer"
                value={batchTextAnswer}
                onChange={(e) => setBatchTextAnswer(e.target.value)}
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
              <span className="text-sm text-muted-foreground ml-auto">
                {t("evaluation.selectedCount", { count: selectedTaskIds.size })}
              </span>
            </div>
            <div className="flex flex-col gap-2 md:max-h-[50vh] md:overflow-auto">
              {tasks
                .filter((task) => getTaskStatus(task, t).active)
                .map((task) => (
                  <div
                    key={task.wid}
                    className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleTaskSelection(task.wid || "")}
                  >
                    <Checkbox
                      checked={selectedTaskIds.has(task.wid || "")}
                      onCheckedChange={() => toggleTaskSelection(task.wid || "")}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-sm">{task.course_name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {task.teacher_name} · {task.term_name}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button variant="outline" onClick={() => setBatchSelectOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button onClick={goToBatchPreview} disabled={selectedTaskIds.size === 0}>
              {t("evaluation.nextStep")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      {/* Batch progress dialog */}
      <ResponsiveModal open={batchProgressOpen} onOpenChange={(v) => { if (!v) abortBatch(); }}>
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("evaluation.batchProgressTitle")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              {batchPhase === "fill" ? t("evaluation.batchPhaseFill") : t("evaluation.batchPhaseSubmit")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-4">
            <Progress
              value={
                batchTasks.length > 0
                  ? ((batchCurrentIdx + 1) / batchTasks.length) * 100
                  : 0
              }
            />
            <div className="text-sm text-muted-foreground">
              {batchCurrentIdx < batchTasks.length
                ? `${batchCurrentIdx + 1} / ${batchTasks.length} · ${batchTasks[batchCurrentIdx]?.task.course_name || ""}`
                : `${t("evaluation.batchSuccess", { success: batchTasks.filter((r) => r.status === "submitted").length, failed: batchTasks.filter((r) => r.status === "failed").length })}`}
            </div>
            <div className="flex flex-col gap-2 md:max-h-[40vh] md:overflow-auto">
              {batchTasks.map((r, idx) => {
                const statusMap = {
                  pending: { label: t("evaluation.batchTaskStatusPending"), color: "text-muted-foreground" },
                  filling: { label: t("evaluation.batchTaskStatusProcessing"), color: "text-primary" },
                  filled: { label: t("evaluation.batchTaskStatusSuccess"), color: "text-primary" },
                  submitting: { label: t("evaluation.batchTaskStatusProcessing"), color: "text-primary" },
                  submitted: { label: t("evaluation.batchTaskStatusSuccess"), color: "text-primary" },
                  failed: { label: t("evaluation.batchTaskStatusFailed"), color: "text-destructive" },
                };
                const s = statusMap[r.status];
                return (
                  <div key={idx} className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium truncate">{r.task.course_name}</span>
                      <span className="text-xs text-muted-foreground truncate">{r.task.teacher_name}</span>
                    </div>
                    <span className={`shrink-0 text-xs ${s.color}`}>{s.label}</span>
                  </div>
                );
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
        onOpenChange={(v) => {
          if (!v && batchDetailIdx !== null) {
            setBatchDetailIdx(null);
            return;
          }
          setBatchPreviewOpen(v);
          if (!v) setBatchDetailIdx(null);
        }}
      >
        <ResponsiveModalContent className="flex flex-col sm:max-w-3xl max-h-[90vh] overflow-hidden">
          <div
            key={batchDetailIdx === null ? "list" : "detail"}
            className="flex min-h-0 flex-1 flex-col animate-in fade-in-50 duration-200"
          >
          {batchDetailIdx === null ? (
            <>
              <ResponsiveModalHeader>
                <ResponsiveModalTitle>{t("evaluation.batchPreviewTitle")}</ResponsiveModalTitle>
                <ResponsiveModalDescription>{t("evaluation.batchPreviewDesc")}</ResponsiveModalDescription>
              </ResponsiveModalHeader>
              <ResponsiveModalBody className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-2 px-0.5 py-1 md:gap-3 md:px-2 md:pb-2">
                  {batchTasks.map((r, idx) => (
                    <Card
                      key={idx}
                      className={cn(
                        "cursor-pointer py-3 transition-colors hover:bg-muted/40 md:py-4",
                        r.status === "failed" && "opacity-60",
                      )}
                      onClick={() => setBatchDetailIdx(idx)}
                    >
                      <CardHeader className="py-0 md:py-0">
                        <CardTitle className="text-base truncate">{r.task.course_name}</CardTitle>
                        <CardDescription className="truncate">{r.task.teacher_name}</CardDescription>
                        <CardAction className="self-center">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={r.status === "filled" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
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
              <ResponsiveModalFooter className="flex flex-col sm:flex-row gap-2">
                <Button variant="outline" onClick={() => setBatchPreviewOpen(false)}>
                  {t("evaluation.cancel")}
                </Button>
                <Button onClick={runBatchSubmit} disabled={batchTasks.filter((r) => r.status === "filled").length === 0}>
                  {t("evaluation.batchContinue")}
                </Button>
              </ResponsiveModalFooter>
            </>
          ) : (
            (() => {
              const r = batchTasks[batchDetailIdx];
              if (!r) return null;
              return (
                <>
                  <ResponsiveModalHeader>
                    <ResponsiveModalTitle className="truncate">{r.task.course_name}</ResponsiveModalTitle>
                    <ResponsiveModalDescription className="truncate">{r.task.teacher_name}</ResponsiveModalDescription>
                  </ResponsiveModalHeader>
                  <ResponsiveModalBody className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto text-sm">
                    {r.status === "filled" && r.scoreResult && (
                      <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3">
                        {Object.entries(r.scoreResult).map(([k, v]) => (
                          <div key={k} className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-xs">{t(`evaluation.previewKeys.${k}` as never) || k}</span>
                            {renderScoreBlock(k, v, t)}
                          </div>
                        ))}
                      </div>
                    )}
                    {r.status === "filled" && r.detail.questions.length > 0 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">{t("evaluation.batchAnswers")}</span>
                        <div className="flex flex-col divide-y divide-border">
                          {formatAnswerPreview(r.detail, r.answers).map((item) => (
                            <div key={item.order} className="flex flex-col gap-1 py-2">
                              <span className="text-muted-foreground" title={item.text}>
                                {item.order}. {item.text}
                              </span>
                              <span className="font-medium" title={item.answer}>{item.answer}</span>
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
              );
            })()
          )}
          </div>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  );
}
