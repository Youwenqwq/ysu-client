"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  LoadingCards,
  useErrorToast,
} from "@/components/academic/list-state";
import { FilterChips } from "@/components/academic/filter-chips";
import { formatTimeRange } from "@/lib/academic/time";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useMakeupExamBatches, useMakeupExamCourses } from "@/providers/hooks";
import { useProvider } from "@/providers/use-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MakeupExamCourse } from "@/providers/types";
import { Clock, FilePenLine, School } from "lucide-react";

export default function MakeupExamsPage() {
  const { t } = useTranslation();
  const provider = useProvider();
  const [selectedBatchId, setSelectedBatchId] = useState<string>();
  const [tab, setTab] = useState<"available" | "registered">("available");
  const [signupTarget, setSignupTarget] = useState<MakeupExamCourse | null>(null);
  const [signingUp, setSigningUp] = useState(false);

  const batchesQuery = useMakeupExamBatches();
  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);

  useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      setSelectedBatchId(batches[0]!.batchId);
    }
  }, [batches, selectedBatchId]);

  const coursesQuery = useMakeupExamCourses({
    batchId: selectedBatchId,
    registered: tab === "registered",
  });
  const courses = coursesQuery.data ?? [];

  useErrorToast(batchesQuery.error);
  useErrorToast(coursesQuery.error);

  async function handleSignupConfirm() {
    if (!signupTarget?.taskId || !signupTarget?.batchId) return;
    setSigningUp(true);
    try {
      await provider.signupMakeupExam({
        taskId: signupTarget.taskId,
        batchId: signupTarget.batchId,
      });
      toast.success(t("makeupExams.signupSuccess"));
      setSignupTarget(null);
      await Promise.all([coursesQuery.mutate(), batchesQuery.mutate()]);
    } catch (e) {
      toast.error((e as Error).message || t("app.updating"));
    } finally {
      setSigningUp(false);
    }
  }

  const selectedBatch = batches.find((b) => b.batchId === selectedBatchId);
  const loading =
    batchesQuery.isLoading ||
    batchesQuery.isValidating ||
    (coursesQuery.isLoading && courses.length === 0);

  if (batchesQuery.isLoading && batches.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-10" />
        <LoadingCards className="h-28" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("makeupExams.noBatch")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <FilterChips
            items={batches.map((b) => ({ value: b.batchId, label: b.name }))}
            value={selectedBatchId}
            onChange={setSelectedBatchId}
          />
          {selectedBatch && (
            <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {(selectedBatch.signupStart || selectedBatch.signupEnd) && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 shrink-0" />
                  <span>
                    {t("makeupExams.signupWindow")}:{" "}
                    {formatTimeRange(selectedBatch.signupStart, selectedBatch.signupEnd)}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge variant="outline">
                  {t("makeupExams.availableCount", {
                    count: selectedBatch.availableCount,
                  })}
                </Badge>
                <Badge variant="outline">
                  {t("makeupExams.registeredCount", {
                    count: selectedBatch.registeredCount,
                  })}
                </Badge>
              </div>
            </div>
          )}
        </div>
      )}

      {batches.length > 0 && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "available" | "registered")}
        >
          <TabsList className="w-full">
            <TabsTrigger value="available">{t("makeupExams.availableTab")}</TabsTrigger>
            <TabsTrigger value="registered">{t("makeupExams.registeredTab")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {batches.length > 0 &&
        (loading && courses.length === 0 ? (
          <LoadingCards className="h-28" />
        ) : courses.length === 0 ? (
          <EmptyState
            title={
              tab === "available"
                ? t("makeupExams.noAvailable")
                : t("makeupExams.noRegistered")
            }
            description={t("makeupExams.description")}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {courses.map((course, idx) => (
              <Card key={`${course.taskId || course.code}-${idx}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{course.name}</CardTitle>
                    {course.status && (
                      <Badge variant={tab === "registered" ? "default" : "secondary"}>
                        {course.status}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    {[course.code, course.examSeq].filter(Boolean).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                    {course.credit && (
                      <span>
                        {t("makeupExams.credit")}: {course.credit}
                      </span>
                    )}
                    {course.hours && (
                      <span>
                        {t("makeupExams.hours")}: {course.hours}
                      </span>
                    )}
                  </div>
                  {course.department && (
                    <div className="flex items-center gap-2">
                      <School className="size-4 shrink-0 text-muted-foreground" />
                      <span>{course.department}</span>
                    </div>
                  )}
                  {(course.signupStart || course.signupEnd) && (
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 shrink-0 text-muted-foreground" />
                      <span>{formatTimeRange(course.signupStart, course.signupEnd)}</span>
                    </div>
                  )}
                  {course.note && (
                    <div className="flex items-center gap-2">
                      <FilePenLine className="size-4 shrink-0 text-muted-foreground" />
                      <span>{course.note}</span>
                    </div>
                  )}
                  {tab === "available" && course.taskId && course.batchId && (
                    <Button
                      size="sm"
                      className="mt-1 self-start"
                      onClick={() => setSignupTarget(course)}
                    >
                      {t("makeupExams.signup")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ))}

      <Dialog
        open={signupTarget !== null}
        onOpenChange={(open) => {
          if (!open && !signingUp) setSignupTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("makeupExams.signupTitle")}</DialogTitle>
            <DialogDescription>
              {t("makeupExams.signupDesc", { name: signupTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={signingUp}
              onClick={() => setSignupTarget(null)}
            >
              {t("makeupExams.cancel")}
            </Button>
            <Button onClick={handleSignupConfirm} disabled={signingUp}>
              {signingUp && <Spinner data-icon="inline-start" />}
              {t("makeupExams.signup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
