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
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore } from "@/lib/settings-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { getExams } from "@/lib/api";
import { syncExamsToWidget } from "@/lib/widget-bridge";
import type { Exam } from "@/lib/types";
import {
  CalendarOff,
  CheckCircle2,
  Clock,
  MapPin,
  Search,
} from "lucide-react";

function getExamEndTime(exam: Exam): Date | null {
  if (!exam.exam_date) return null;
  const base = new Date(exam.exam_date.replace(/-/g, "/"));
  if (Number.isNaN(base.getTime())) return null;

  if (exam.exam_time) {
    const times = exam.exam_time.match(/\d{1,2}:\d{2}/g);
    if (times && times.length >= 2) {
      const [h, m] = times[times.length - 1].split(":").map(Number);
      base.setHours(h, m, 0, 0);
      return base;
    } else if (times && times.length === 1) {
      const [h, m] = times[0].split(":").map(Number);
      base.setHours(h, m, 0, 0);
      return base;
    }
  }
  base.setHours(23, 59, 59, 999);
  return base;
}

function isExamCompleted(exam: Exam): boolean {
  const end = getExamEndTime(exam);
  if (!end) return false;
  return end < new Date();
}

export default function ExamsPage() {
  const credential = useAuthStore((s) => s.credential);
  const { t } = useTranslation();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [term, setTerm] = useState("");
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours);

  useEffect(() => {
    if (!credential) return;
    async function load() {
      try {
        const e = await getExams(credential!);
        setExams(e);
        syncExamsToWidget(e, widgetSyncReminderHours).catch(() => {});
      } catch (err) {
        toast.error((err as Error).message || t("app.updating"));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [credential, t, widgetSyncReminderHours]);

  async function handleQuery() {
    if (!credential) return;
    setLoading(true);
    try {
      const e = await getExams(credential, term || undefined);
      setExams(e);
      syncExamsToWidget(e, widgetSyncReminderHours).catch(() => {});
    } catch (err) {
      toast.error((err as Error).message || t("app.updating"));
    } finally {
      setLoading(false);
    }
  }

  function compareExamDate(a: Exam, b: Exam) {
    const da = a.exam_date ? new Date(a.exam_date.replace(/-/g, "/")).getTime() : 0;
    const db = b.exam_date ? new Date(b.exam_date.replace(/-/g, "/")).getTime() : 0;
    return da - db;
  }

  const upcomingExams = exams.filter((e) => !isExamCompleted(e)).sort(compareExamDate);
  const completedExams = exams.filter((e) => isExamCompleted(e)).sort(compareExamDate);

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
                    <CardDescription>{exam.exam_name}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <span>{exam.exam_time}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="size-4 text-muted-foreground" />
                      <span>{exam.exam_location}</span>
                    </div>
                    {exam.seat_number && (
                      <Badge variant="outline">{t("exams.seatNumber")}: {exam.seat_number}</Badge>
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
                      <CardDescription>{exam.exam_name}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{exam.exam_time}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        <span>{exam.exam_location}</span>
                      </div>
                      {exam.seat_number && (
                        <Badge variant="outline">{t("exams.seatNumber")}: {exam.seat_number}</Badge>
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
