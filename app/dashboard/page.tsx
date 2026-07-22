"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { compareExamStartTime, formatExamTime, isExamCompleted } from "@/lib/academic/exam-utils";
import { useSettingsStore } from "@/lib/stores/settings";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  useClassPeriods,
  useCurrentWeek,
  useEvaluationTasks,
  useExams,
  useGPAStats,
  useSchedule,
  useStudentInfo,
} from "@/providers/hooks";
import { cn } from "@/lib/utils";
import {
  buildSectionTimeMap,
  courseEndSection,
  courseStartSection,
  courseWeekDay,
  isCourseActiveInWeek,
  isCoursePast,
  periodIsInUse,
} from "@/app/dashboard/schedule/schedule-utils";
import { syncScheduleToWidget, syncExamsToWidget } from "@/lib/native/widget-bridge";
import { syncClassAlarmsToNative } from "@/lib/native/notify";
import type { Course } from "@/providers/types";
import { Calendar, ChevronRight, ClipboardCheck, GraduationCap, BarChart3, Clock, BookOpen, Eye, EyeOff } from "lucide-react";

function isCourseActiveToday(course: Course, currentWeek: number, currentWeekday: number): boolean {
  if (courseWeekDay(course) !== currentWeekday) return false;
  return isCourseActiveInWeek(course, currentWeek);
}

export default function DashboardPage() {
  const router = useRouter();
  const avatarImage = useSettingsStore((s) => s.avatarImage);
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours);
  const widgetShowNextDaySchedule = useSettingsStore((s) => s.widgetShowNextDaySchedule);
  const { t } = useTranslation();
  const showGPA = useSettingsStore((s) => s.gpaVisible);
  const setShowGPA = useSettingsStore((s) => s.setGpaVisible);

  /** HH:mm（分钟数 → 时钟文本） */
  const clockText = (minutes: number): string =>
    `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

  /** 倒计时文本：>=60 分钟用「X 小时 Y 分」，否则「Y 分钟」。 */
  const countdownText = (minutes: number): string => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest > 0
        ? t("dashboard.hoursMinutes", { hours, minutes: rest })
        : t("dashboard.hoursOnly", { hours });
    }
    return t("dashboard.minutesOnly", { minutes: Math.max(1, minutes) });
  };

  /** 考试的日历天数差（0=今天，1=明天）。 */
  const examDayDiff = (timestamp: number): number => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const exam = new Date(timestamp);
    const day = new Date(exam.getFullYear(), exam.getMonth(), exam.getDate()).getTime();
    return Math.round((day - today) / 86_400_000);
  };

  const student = useStudentInfo();
  const currentWeek = useCurrentWeek();
  const gpa = useGPAStats();
  const schedule = useSchedule({ courseCategory: "all", includeLabSchedule: true });
  const exams = useExams();
  const periodsRaw = useClassPeriods();
  const evaluationTasks = useEvaluationTasks();

  // 只统计进行中的评教任务：未开始/已结束的任务学生无法操作，不打扰。
  const pendingEvaluationCount = useMemo(
    () => (evaluationTasks.data ?? []).filter((task) => task.status === "active").length,
    [evaluationTasks.data],
  );

  const courses = useMemo(() => schedule.data ?? [], [schedule.data]);
  const examRows = useMemo(() => exams.data ?? [], [exams.data]);
  const periods = useMemo(() => {
    if (!periodsRaw.data) return [];
    return periodsRaw.data.filter(periodIsInUse).sort((a, b) => a.section - b.section);
  }, [periodsRaw.data]);

  const errors = useMemo(
    () => [student.error, currentWeek.error, gpa.error, schedule.error, exams.error, periodsRaw.error].filter(Boolean),
    [student.error, currentWeek.error, gpa.error, schedule.error, exams.error, periodsRaw.error],
  );

  useEffect(() => {
    if (errors.length === 0) return;
    toast.error(errors[0]?.message || t("app.updating"));
  }, [errors, t]);

  // Sync courses to widget when fresh data arrives
  const activeCoursesForWidget = useMemo(() => {
    if (!currentWeek.data || !schedule.data) return null;
    return schedule.data.filter((c) => isCourseActiveInWeek(c, currentWeek.data!.week));
  }, [schedule.data, currentWeek.data]);

  useEffect(() => {
    if (activeCoursesForWidget) {
      syncScheduleToWidget(activeCoursesForWidget, currentWeek.data ?? null, periods, widgetSyncReminderHours, widgetShowNextDaySchedule).catch(() => {});
      syncClassAlarmsToNative(activeCoursesForWidget, currentWeek.data ?? null, periods).catch(() => {});
    }
  }, [activeCoursesForWidget, currentWeek.data, periods, widgetSyncReminderHours, widgetShowNextDaySchedule]);

  // Sync exams to widget when fresh data arrives
  useEffect(() => {
    if (exams.data && exams.data.length > 0) {
      syncExamsToWidget(exams.data, widgetSyncReminderHours).catch(() => {});
    }
  }, [exams.data, widgetSyncReminderHours]);

  const hooks = [student, currentWeek, gpa, schedule, exams, periodsRaw];
  const anyLoading = hooks.some((h) => h.isLoading);
  const hasAnyData = hooks.some((h) => h.data != null);

  const todayCourses = useMemo(() => {
    if (!currentWeek.data) return [];
    return courses
      .filter((c) => isCourseActiveToday(c, currentWeek.data!.week, currentWeek.data!.weekday))
      .sort((a, b) => courseStartSection(a) - courseStartSection(b));
  }, [courses, currentWeek.data]);

  const upcomingExams = useMemo(() => {
    return examRows
      .filter((e) => !isExamCompleted(e))
      .sort(compareExamStartTime)
  }, [examRows]);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods]);

  const currentCourse = useMemo(() => {
    if (Object.keys(timeMap).length === 0) return null;
    for (const c of todayCourses) {
      for (let s = courseStartSection(c); s <= courseEndSection(c); s++) {
        const range = timeMap[s];
        if (range && nowMinutes >= range[0] && nowMinutes <= range[1]) {
          return c;
        }
      }
    }
    return null;
  }, [todayCourses, nowMinutes, timeMap]);

  /** 课程的首节开始/末节结束时刻（分钟）。 */
  const courseTimeRange = (c: Course): [number, number] | null => {
    const start = timeMap[courseStartSection(c)];
    const end = timeMap[courseEndSection(c)];
    return start && end ? [start[0], end[1]] : null;
  };

  const currentRange = currentCourse ? courseTimeRange(currentCourse) : null;

  let nextCourseInfo: { course: Course; range: [number, number] } | null = null;
  if (!currentCourse) {
    for (const c of todayCourses) {
      const start = timeMap[courseStartSection(c)];
      const end = timeMap[courseEndSection(c)];
      if (start && end && start[0] > nowMinutes) {
        nextCourseInfo = { course: c, range: [start[0], end[1]] };
        break;
      }
    }
  }

  if (anyLoading && !hasAnyData) {
    return (
      <div className="flex flex-col gap-8">
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <Card className="md:hidden">
        <CardHeader className="flex flex-row items-center gap-3 pb-3">
          <Avatar className="size-14 shrink-0">
            {avatarImage && <AvatarImage src={avatarImage} alt="avatar" />}
            <AvatarFallback className="text-base font-medium">
              {student.data?.name ? student.data.name.slice(-2) : "--"}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <CardTitle className="truncate text-base">{student.data?.name || "-"}</CardTitle>
            {student.data?.department && (
              <CardDescription className="truncate">
                {student.data.department}
              </CardDescription>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 border-t pt-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <Calendar className="size-3.5 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">
                {t("dashboard.currentWeek", { week: currentWeek.data?.week || "-" })}
              </span>
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {currentWeek.data?.weekday ? t(`dashboard.weekdayNames.${currentWeek.data.weekday}`) : "-"}
              {currentWeek.data?.semester && ` · ${currentWeek.data.semester}`}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowGPA(!showGPA)}
            className="flex min-w-0 flex-col gap-0.5 text-left transition-opacity active:opacity-70"
          >
            <div className="flex items-center gap-1.5">
              <BarChart3 className="size-3.5 shrink-0 text-primary" />
              <span className="truncate text-sm font-medium">{t("dashboard.gpaInitial")}</span>
              {showGPA ? (
                <EyeOff className="ml-auto size-3 shrink-0 text-muted-foreground" />
              ) : (
                <Eye className="ml-auto size-3 shrink-0 text-muted-foreground" />
              )}
            </div>
            <span className="truncate text-base font-semibold tabular-nums">
              {showGPA ? gpa.data?.gpaInitial || "-" : "***"}
            </span>
          </button>
        </CardContent>
      </Card>

      <div className="hidden gap-6 md:grid md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <GraduationCap className="size-6 text-primary shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{student.data?.name || "-"}</CardTitle>
              <CardDescription className="truncate">{student.data?.studentId || ""}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground truncate">
            {student.data?.department} · {student.data?.major}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Calendar className="size-6 text-primary shrink-0" />
            <div>
              <CardTitle className="text-base">{t("dashboard.currentWeek", { week: currentWeek.data?.week || "-" })}</CardTitle>
              <CardDescription>{currentWeek.data?.weekday ? t(`dashboard.weekdayNames.${currentWeek.data.weekday}`) : "-"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {currentWeek.data?.semester || ""}
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" onClick={() => setShowGPA(!showGPA)}>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <BarChart3 className="size-6 text-primary shrink-0" />
            <div>
              <CardTitle className="text-base">
                {showGPA ? gpa.data?.gpaInitial || "-" : "***"}
              </CardTitle>
              <CardDescription>{t("dashboard.gpaInitial")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {showGPA
              ? `${t("dashboard.weightedAvg")} ${gpa.data?.weightedAvg || "-"} · ${t("dashboard.arithmeticAvg")} ${gpa.data?.arithmeticAvg || "-"}`
              : t("dashboard.gpaInitial")
            }
          </CardContent>
        </Card>

        <Card className="cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md" onClick={() => router.push("/dashboard/evaluation")}>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Clock className="size-6 text-primary shrink-0" />
            <div>
              <CardTitle className="text-base">{t("app.evaluation")}</CardTitle>
              <CardDescription>{t("evaluation.title")}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {t("evaluation.description")}
          </CardContent>
        </Card>
      </div>

      {pendingEvaluationCount > 0 && (
        <button
          type="button"
          onClick={() => router.push("/dashboard/evaluation")}
          className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-left transition-colors active:bg-primary/10"
        >
          <ClipboardCheck className="size-5 shrink-0 text-primary" />
          <span className="flex-1 text-sm font-medium">
            {t("dashboard.pendingEvaluation", { count: pendingEvaluationCount })}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {currentCourse && currentRange ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-primary">
                {t("dashboard.ongoingNow")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("dashboard.remaining", { time: countdownText(currentRange[1] - nowMinutes) })}
              </span>
            </div>
            <span className="text-lg font-semibold">{currentCourse.name}</span>
            <span className="text-sm text-muted-foreground">
              {[currentCourse.teacher, currentCourse.classroom].filter(Boolean).join(" · ")}
            </span>
            <div className="h-1.5 rounded-full bg-primary/15">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      ((nowMinutes - currentRange[0]) / (currentRange[1] - currentRange[0])) * 100,
                    ),
                  )}%`,
                }}
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {clockText(currentRange[0])} - {clockText(currentRange[1])}
            </span>
          </CardContent>
        </Card>
      ) : nextCourseInfo ? (
        <Card>
          <CardContent className="flex flex-col gap-2 py-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {t("dashboard.nextCourse")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("dashboard.startsIn", { time: countdownText(nextCourseInfo.range[0] - nowMinutes) })}
              </span>
            </div>
            <span className="text-lg font-semibold">{nextCourseInfo.course.name}</span>
            <span className="text-sm text-muted-foreground">
              {[nextCourseInfo.course.teacher, nextCourseInfo.course.classroom]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <span className="text-xs text-muted-foreground">
              {clockText(nextCourseInfo.range[0])} - {clockText(nextCourseInfo.range[1])}
            </span>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <CardTitle className="text-base">{t("dashboard.todayCourses")}</CardTitle>
          </div>
          {currentCourse && (
            <Badge variant="default" className="gap-1">
              <Clock className="size-3" />
              {t("dashboard.currentCourse")}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {todayCourses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noCoursesToday")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {todayCourses.map((c, idx) => {
                const isCurrent = currentCourse === c;
                const isPast = !isCurrent && isCoursePast(c, nowMinutes, timeMap);
                const range = courseTimeRange(c);
                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3",
                      isCurrent && "border-primary bg-primary/5",
                      isPast && "opacity-50",
                    )}
                  >
                    {range && (
                      <div className="flex w-11 shrink-0 flex-col text-xs leading-tight text-muted-foreground">
                        <span>{clockText(range[0])}</span>
                        <span>{clockText(range[1])}</span>
                      </div>
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-sm">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.teacher} · {c.classroom}
                      </span>
                    </div>
                    {isCurrent ? (
                      <Badge variant="default" className="shrink-0">
                        {t("dashboard.ongoingNow")}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0">
                        {t("dashboard.sectionRange", { start: courseStartSection(c), end: courseEndSection(c) })}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="size-5 text-primary" />
            <CardTitle className="text-base">{t("dashboard.upcomingExams")}</CardTitle>
          </div>
          <Badge variant="secondary">{t("dashboard.examCount", { count: upcomingExams.length })}</Badge>
        </CardHeader>
        <CardContent>
          {upcomingExams.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("dashboard.noExams")}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {upcomingExams.map((exam, idx) => {
                const dayDiff = exam.startTimestamp ? examDayDiff(exam.startTimestamp) : null;
                return (
                  <div key={idx} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium text-sm">{exam.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {[formatExamTime(exam), exam.examLocation, exam.seatNumber ? t("dashboard.seatNumber", { num: exam.seatNumber }) : ""].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    {dayDiff !== null && dayDiff >= 0 && (
                      <Badge variant={dayDiff <= 1 ? "default" : "secondary"} className="shrink-0">
                        {dayDiff === 0
                          ? t("dashboard.examToday")
                          : dayDiff === 1
                            ? t("dashboard.examTomorrow")
                            : t("dashboard.examInDays", { count: dayDiff })}
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
