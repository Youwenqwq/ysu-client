"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSettingsStore } from "@/lib/stores/settings";
import { useTranslation } from "@/lib/i18n/use-translation";
import { compareExamStartTime, formatExamTime, isExamCompleted } from "@/lib/academic/exam-utils";
import { syncExamsToWidget } from "@/lib/native/widget-bridge";
import { useExams } from "@/providers/hooks";
import {
  CalendarOff,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
} from "lucide-react";

export default function ExamsPage() {
  const { t } = useTranslation();
  const [term, setTerm] = useState("");
  const [queriedTerm, setQueriedTerm] = useState("");
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours);
  const examsQuery = useExams({ semester: queriedTerm || undefined });
  const exams = examsQuery.data ?? [];
  const loading = examsQuery.isLoading || examsQuery.isValidating;

  useEffect(() => {
    if (!examsQuery.data) return;
    syncExamsToWidget(examsQuery.data, widgetSyncReminderHours).catch(() => {});
  }, [examsQuery.data, widgetSyncReminderHours]);

  useEffect(() => {
    if (!examsQuery.error) return;
    toast.error(examsQuery.error.message || t("app.updating"));
  }, [examsQuery.error, t]);

  async function handleQuery() {
    const nextTerm = term.trim();
    if (nextTerm === queriedTerm) {
      await examsQuery.mutate();
      return;
    }
    setQueriedTerm(nextTerm);
  }

  const upcomingExams = exams.filter((e) => !isExamCompleted(e)).sort(compareExamStartTime);
  const completedExams = exams.filter((e) => isExamCompleted(e)).sort(compareExamStartTime);

  if (loading && exams.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("exams.title")}</CardTitle>
          <CardDescription>{t("exams.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
            <Field className="w-48">
              <FieldLabel htmlFor="exams-term">{t("exams.termLabel")}</FieldLabel>
              <Input
                id="exams-term"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={t("exams.termPlaceholder")}
              />
            </Field>
            <Button onClick={handleQuery} disabled={loading}>
              {loading ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Search data-icon="inline-start" />
              )}
              {t("exams.query")}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      {exams.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOff />
            </EmptyMedia>
            <EmptyTitle>{t("exams.noData")}</EmptyTitle>
            <EmptyDescription>{t("exams.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {upcomingExams.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingExams.map((exam, idx) => (
                <Card key={idx}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{exam.name}</CardTitle>
                      <Badge variant="default">{t("exams.upcomingExams")}</Badge>
                    </div>
                    <CardDescription>{exam.examName}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <span>{formatExamTime(exam)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="size-4 text-muted-foreground" />
                      <span>{exam.examLocation}</span>
                    </div>
                    {exam.seatNumber && (
                      <Badge variant="outline">{t("exams.seatNumber")}: {exam.seatNumber}</Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {completedExams.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-muted-foreground">{t("exams.completedExams")}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {completedExams.map((exam, idx) => (
                  <Card key={idx} className="opacity-60">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base">{exam.name}</CardTitle>
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="size-3" />
                          {t("exams.completed")}
                        </Badge>
                      </div>
                      <CardDescription>{exam.examName}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{formatExamTime(exam)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        <span>{exam.examLocation}</span>
                      </div>
                      {exam.seatNumber && (
                        <Badge variant="outline">{t("exams.seatNumber")}: {exam.seatNumber}</Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
