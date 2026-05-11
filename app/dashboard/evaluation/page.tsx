"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
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
import { Sparkles } from "lucide-react";

interface BatchTaskResult {
  task: EvaluationTask;
  detail: EvaluationDetail;
  answers: Record<string, EvaluationAnswer>;
  scoreResult: Record<string, unknown> | null;
  status: "pending" | "filling" | "filled" | "submitting" | "submitted" | "failed";
  error?: string;
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
  const abortRef = useRef(false);

  useEffect(() => {
    if (!credential) return;
    async function load() {
      try {
        const t = await getEvaluationTypes(credential!);
        setTypes(t);
      } catch (err) {
        toast.error((err as Error).message || t("app.updating"));
      } finally {
        setLoadingTypes(false);
      }
    }
    load();
  }, [credential, t]);

  async function handleSelectType(code: string) {
    if (!credential) return;
    setSelectedType(code);
    setLoadingTasks(true);
    try {
      const t = await getPendingEvaluations(credential, code);
      setTasks(t);
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

  function autoFillMaxScore(targetAnswers?: Record<string, EvaluationAnswer>, targetDetail?: EvaluationDetail | null): Record<string, EvaluationAnswer> {
    const d = targetDetail || detail;
    if (!d) return {};
    const next: Record<string, EvaluationAnswer> = targetAnswers ? { ...targetAnswers } : { ...answers };
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
          text: "优秀",
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
        teacher_relation_id: selectedTask.teacher_id || "",
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
        teacher_relation_id: selectedTask.teacher_id || "",
        course_name: selectedTask.course_name || "",
        teacher_name: selectedTask.teacher_name || "",
        sequence: Number(selectedTask.sequence),
      });
      toast.success(t("evaluation.submit"));
      setDialogOpen(false);
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
    setSelectedTaskIds(new Set(activeTasks.map((t) => t.wid || "").filter(Boolean)));
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
    runBatchFill(initialResults);
  }

  async function runBatchFill(initialResults: BatchTaskResult[]) {
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
        const filled = autoFillMaxScore(initial, d);
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
          teacher_relation_id: task.teacher_id || "",
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
          teacher_relation_id: task.teacher_id || "",
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
    if (selectedType) {
      handleSelectType(selectedType);
    }
  }

  function abortBatch() {
    abortRef.current = true;
    setBatchProgressOpen(false);
    toast.info(t("evaluation.cancel"));
  }

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
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t("evaluation.title")}</CardTitle>
              <CardDescription>{t("evaluation.description")}</CardDescription>
            </div>
            {selectedType && tasks.filter((task) => getTaskStatus(task, t).active).length > 0 && (
              <Button variant="outline" size="sm" onClick={openBatchSelect}>
                <Sparkles className="size-4 mr-1" />
                {t("evaluation.batchAuto")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
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
              {types.find((t) => t.code === selectedType)?.name}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingTasks ? (
              <Skeleton className="h-48" />
            ) : tasks.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">{t("evaluation.noTasks")}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {tasks.map((task) => {
                  const status = getTaskStatus(task, t);
                  return (
                    <Card
                      key={task.wid}
                      className={status.active ? "cursor-pointer" : "opacity-60"}
                      onClick={() => handleOpenTask(task)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0">
                            <CardTitle className="text-base truncate">{task.course_name}</CardTitle>
                            <CardDescription className="truncate">{task.teacher_name}</CardDescription>
                          </div>
                          <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                        </div>
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
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-5xl w-[90vw] max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{detail?.name || t("evaluation.title")}</DialogTitle>
            <DialogDescription>
              {selectedTask?.course_name} - {selectedTask?.teacher_name}
            </DialogDescription>
          </DialogHeader>

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
                  <Sparkles className="size-4 mr-1" />
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
                      placeholder="请输入答案"
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

          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button variant="secondary" onClick={handlePreview} disabled={submitting || loadingDetail}>
              {submitting ? t("evaluation.previewing") : t("evaluation.preview")}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting || loadingDetail}>
              {submitting ? t("evaluation.submitting") : t("evaluation.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("evaluation.previewResult")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-sm">
            {previewResult && Object.entries(previewResult).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={() => setPreviewOpen(false)}>{t("evaluation.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch selection dialog */}
      <Dialog open={batchSelectOpen} onOpenChange={setBatchSelectOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("evaluation.batchSelectTitle")}</DialogTitle>
            <DialogDescription>{t("evaluation.batchSelectDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
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
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-auto">
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
                      className="mt-0.5"
                    />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-sm">{task.course_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {task.teacher_name} · {task.term_name}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchSelectOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button onClick={goToBatchPreview} disabled={selectedTaskIds.size === 0}>
              {t("evaluation.nextStep")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch progress dialog */}
      <Dialog open={batchProgressOpen} onOpenChange={(v) => { if (!v) abortBatch(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("evaluation.batchProgressTitle")}</DialogTitle>
            <DialogDescription>
              {batchPhase === "fill" ? t("evaluation.batchPhaseFill") : t("evaluation.batchPhaseSubmit")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${batchTasks.length > 0 ? ((batchCurrentIdx + 1) / batchTasks.length) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="text-sm text-muted-foreground">
              {batchCurrentIdx < batchTasks.length
                ? `${batchCurrentIdx + 1} / ${batchTasks.length} · ${batchTasks[batchCurrentIdx]?.task.course_name || ""}`
                : `${t("evaluation.batchSuccess", { success: batchTasks.filter((r) => r.status === "submitted").length, failed: batchTasks.filter((r) => r.status === "failed").length })}`}
            </div>
            <div className="flex flex-col gap-2 max-h-[40vh] overflow-auto">
              {batchTasks.map((r, idx) => {
                const statusMap = {
                  pending: { label: t("evaluation.batchTaskStatusPending"), color: "text-muted-foreground" },
                  filling: { label: t("evaluation.batchTaskStatusProcessing"), color: "text-primary" },
                  filled: { label: t("evaluation.batchTaskStatusSuccess"), color: "text-green-600" },
                  submitting: { label: t("evaluation.batchTaskStatusProcessing"), color: "text-primary" },
                  submitted: { label: t("evaluation.batchTaskStatusSuccess"), color: "text-green-600" },
                  failed: { label: t("evaluation.batchTaskStatusFailed"), color: "text-destructive" },
                };
                const s = statusMap[r.status];
                return (
                  <div key={idx} className="flex items-center justify-between rounded-lg border p-2 text-sm">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium truncate">{r.task.course_name}</span>
                      <span className="text-xs text-muted-foreground truncate">{r.task.teacher_name}</span>
                    </div>
                    <span className={`shrink-0 text-xs ${s.color}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={abortBatch}>
              {t("evaluation.batchAbort")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch preview dialog */}
      <Dialog open={batchPreviewOpen} onOpenChange={setBatchPreviewOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t("evaluation.batchPreviewTitle")}</DialogTitle>
            <DialogDescription>{t("evaluation.batchPreviewDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {batchTasks.map((r, idx) => (
              <Card key={idx} className={r.status === "failed" ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{r.task.course_name}</CardTitle>
                      <CardDescription className="truncate">{r.task.teacher_name}</CardDescription>
                    </div>
                    <Badge variant={r.status === "filled" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                      {r.status === "filled"
                        ? t("evaluation.batchTaskStatusSuccess")
                        : r.status === "failed"
                          ? t("evaluation.batchTaskStatusFailed")
                          : t("evaluation.batchTaskStatusPending")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  {r.status === "filled" && r.scoreResult && (
                    <div className="flex flex-col gap-1">
                      {Object.entries(r.scoreResult).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="font-medium">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {r.status === "failed" && r.error && (
                    <span className="text-destructive text-xs">{r.error}</span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setBatchPreviewOpen(false)}>
              {t("evaluation.cancel")}
            </Button>
            <Button onClick={runBatchSubmit} disabled={batchTasks.filter((r) => r.status === "filled").length === 0}>
              {t("evaluation.batchContinue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
