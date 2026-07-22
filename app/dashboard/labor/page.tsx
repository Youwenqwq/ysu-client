"use client";

import { useEffect, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  useLaborActivities,
  useLaborRecords,
  useLaborSummary,
} from "@/providers/hooks";
import {
  CalendarOff,
  Clock,
  Hourglass,
  MapPin,
  ScrollText,
  User,
} from "lucide-react";

function formatTime(value?: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : "";
}

function formatRange(start?: string, end?: string): string {
  const s = formatTime(start);
  const e = formatTime(end);
  if (s && e) return `${s} ~ ${e}`;
  return s || e;
}

export default function LaborPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"records" | "activities">("records");

  const summaryQuery = useLaborSummary();
  const recordsQuery = useLaborRecords();
  const activitiesQuery = useLaborActivities();

  const summary = summaryQuery.data;
  const records = recordsQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];

  useEffect(() => {
    const error = summaryQuery.error ?? recordsQuery.error ?? activitiesQuery.error;
    if (!error) return;
    toast.error(error.message || t("app.updating"));
  }, [summaryQuery.error, recordsQuery.error, activitiesQuery.error, t]);

  const recordsLoading =
    (recordsQuery.isLoading || recordsQuery.isValidating) && records.length === 0;
  const activitiesLoading =
    (activitiesQuery.isLoading || activitiesQuery.isValidating) &&
    activities.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("labor.title")}</CardTitle>
          <CardDescription>{t("labor.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryQuery.isLoading && !summary ? (
            <div className="flex gap-8">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-12 w-24" />
            </div>
          ) : summary ? (
            <div className="flex gap-8">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("labor.totalHours")}
                </span>
                <span className="text-2xl font-semibold">
                  {summary.totalHours ?? "-"}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {t("labor.hoursUnit")}
                  </span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("labor.totalCredits")}
                </span>
                <span className="text-2xl font-semibold">
                  {summary.totalCredits ?? "-"}
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "records" | "activities")}>
        <TabsList className="w-full">
          <TabsTrigger value="records">{t("labor.recordsTab")}</TabsTrigger>
          <TabsTrigger value="activities">{t("labor.activitiesTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          {recordsLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarOff />
                </EmptyMedia>
                <EmptyTitle>{t("labor.noRecords")}</EmptyTitle>
                <EmptyDescription>{t("labor.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {records.map((record, idx) => (
                <Card key={`${record.name}-${record.timeStart ?? idx}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {record.name}
                        {record.enrollType && (
                          <Badge variant="outline" className="ml-2 align-middle">
                            {record.enrollType}
                          </Badge>
                        )}
                      </CardTitle>
                      {record.status && <Badge variant="secondary">{record.status}</Badge>}
                    </div>
                    <CardDescription>
                      {[record.term, record.category].filter(Boolean).join(" · ")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                      {record.hours !== undefined && (
                        <span className="flex items-center gap-1">
                          <Hourglass className="size-4" />
                          {t("labor.hours")}: {record.hours}
                        </span>
                      )}
                      {record.teacher && (
                        <span className="flex items-center gap-1">
                          <User className="size-4" />
                          {record.teacher}
                        </span>
                      )}
                    </div>
                    {formatRange(record.timeStart, record.timeEnd) && (
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 shrink-0 text-muted-foreground" />
                        <span>{formatRange(record.timeStart, record.timeEnd)}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          {activitiesLoading ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarOff />
                </EmptyMedia>
                <EmptyTitle>{t("labor.noActivities")}</EmptyTitle>
                <EmptyDescription>{t("labor.description")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="flex flex-col gap-4">
              {activities.map((activity, idx) => (
                <Card key={`${activity.name}-${activity.timeStart ?? idx}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{activity.name}</CardTitle>
                      {activity.isEnrolled && (
                        <Badge variant="default">{t("labor.enrolled")}</Badge>
                      )}
                    </div>
                    <CardDescription>
                      {[activity.category, activity.department]
                        .filter(Boolean)
                        .join(" · ")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                      {activity.hours !== undefined && (
                        <span className="flex items-center gap-1">
                          <Hourglass className="size-4" />
                          {t("labor.hours")}: {activity.hours}
                        </span>
                      )}
                      {activity.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="size-4" />
                          {activity.location}
                        </span>
                      )}
                    </div>
                    {formatRange(activity.timeStart, activity.timeEnd) && (
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 shrink-0 text-muted-foreground" />
                        <span>
                          {t("labor.activityTime")}:{" "}
                          {formatRange(activity.timeStart, activity.timeEnd)}
                        </span>
                      </div>
                    )}
                    {formatRange(activity.enrollStart, activity.enrollEnd) && (
                      <div className="flex items-center gap-2">
                        <ScrollText className="size-4 shrink-0 text-muted-foreground" />
                        <span>
                          {t("labor.enrollWindow")}:{" "}
                          {formatRange(activity.enrollStart, activity.enrollEnd)}
                        </span>
                      </div>
                    )}
                    {activity.operation && (
                      <p className="text-xs text-muted-foreground">{activity.operation}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
