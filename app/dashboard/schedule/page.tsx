"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  FilterDrawer,
  FilterTrigger,
} from "@/components/academic/filter-drawer";
import { useTranslation } from "@/lib/i18n/use-translation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileHeaderRight } from "@/lib/stores/mobile-header";
import { useClassPeriods, useCurrentWeek, useExams, useSchedule } from "@/providers/hooks";
import { ChevronLeft, ChevronRight, Search, Grid3x2, Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { isCourseActiveInWeek, periodIsInUse } from "./schedule-utils";
import { computeExamBlocks } from "./exam-blocks";
import { ScheduleTablet } from "./schedule-tablet";
import { ScheduleMobile } from "./schedule-mobile";
import { syncScheduleToWidget } from "@/lib/native/widget-bridge";
import { syncClassAlarmsToNative } from "@/lib/native/notify";
import { useSettingsStore } from "@/lib/stores/settings";

export default function SchedulePage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const compactMode = useSettingsStore((s) => s.scheduleCompactMode);
  const setCompactMode = useSettingsStore((s) => s.setScheduleCompactMode);
  const [selectedWeek, setSelectedWeek] = useState<number>(0);
  const [term, setTerm] = useState("");
  const [queriedTerm, setQueriedTerm] = useState("");
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const scheduleQuery = useSchedule({
    semester: queriedTerm || undefined,
    courseCategory: "all",
    includeLabSchedule: true,
  });
  const currentWeekQuery = useCurrentWeek({ semester: queriedTerm || undefined });
  const periodsQuery = useClassPeriods();
  const examsQuery = useExams({ semester: queriedTerm || undefined });

  const courses = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data]);
  const currentWeek = currentWeekQuery.data ?? null;
  const loading =
    scheduleQuery.isLoading ||
    scheduleQuery.isValidating ||
    currentWeekQuery.isLoading ||
    currentWeekQuery.isValidating ||
    periodsQuery.isLoading ||
    periodsQuery.isValidating;

  // In compact mode, adjust <main> padding-bottom to match the actual nav bar height,
  // so the content area ends exactly at the nav top edge.
  useEffect(() => {
    if (!compactMode) return;
    const main = document.querySelector("main");
    const nav = document.querySelector('nav[aria-label="Primary"]');
    if (!main || !nav) return;
    const adjust = () => {
      main.style.paddingBottom = `${nav.getBoundingClientRect().height}px`;
    };
    adjust();
    const observer = new ResizeObserver(adjust);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      main.style.paddingBottom = "";
    };
  }, [compactMode]);

  const periods = useMemo(() => {
    if (!periodsQuery.data) return [];
    return periodsQuery.data.filter(periodIsInUse).sort((a, b) => a.section - b.section);
  }, [periodsQuery.data]);

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

  function shiftWeek(delta: number) {
    setSelectedWeek((w) => Math.max(1, (w || 1) + delta));
  }

  // 用 ref 持有最新的 periods 数据，避免 periods 变化触发 effect 重新执行
  const periodsRef = useRef(periods);
  useEffect(() => {
    periodsRef.current = periods;
  });

  useEffect(() => {
    if (!currentWeek?.week) return;
    setSelectedWeek((curr) => (curr === 0 ? currentWeek.week : curr));
  }, [currentWeek]);

  useEffect(() => {
    const errors = [scheduleQuery.error, currentWeekQuery.error, periodsQuery.error].filter(Boolean);
    if (errors.length === 0) return;
    toast.error(errors[0]?.message || t("app.updating"));
  }, [scheduleQuery.error, currentWeekQuery.error, periodsQuery.error, t]);

  useEffect(() => {
    if (!scheduleQuery.data || !currentWeek) return;
    const activeCourses = currentWeek.week
      ? scheduleQuery.data.filter((course) => isCourseActiveInWeek(course, currentWeek.week))
      : scheduleQuery.data;
    syncScheduleToWidget(
      activeCourses,
      currentWeek,
      periodsRef.current,
      useSettingsStore.getState().widgetSyncReminderHours,
      useSettingsStore.getState().widgetShowNextDaySchedule,
    ).catch(() => {});
    syncClassAlarmsToNative(activeCourses, currentWeek, periodsRef.current).catch(() => {});
  }, [scheduleQuery.data, currentWeek]);

  async function handleQuery() {
    const nextTerm = term.trim();
    if (nextTerm === queriedTerm) {
      await Promise.all([
        scheduleQuery.mutate(),
        currentWeekQuery.mutate(),
        periodsQuery.mutate(),
      ]);
    } else {
      setQueriedTerm(nextTerm);
      setSelectedWeek(0);
    }
    setFilterDrawerOpen(false);
  }

  useMobileHeaderRight(
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setCompactMode(!compactMode)}
        className="h-8 w-8"
        aria-label={t("schedule.compactHint")}
      >
        {compactMode ? <Grid3x3 className="size-4" /> : <Grid3x2 className="size-4" />}
      </Button>
      <FilterTrigger
        label={selectedWeek ? t("schedule.weekShort", { week: selectedWeek }) : t("schedule.weekLabel")}
        onClick={() => setFilterDrawerOpen(true)}
      />
    </div>,
    [selectedWeek, t, compactMode, setCompactMode],
  );

  const filteredCourses = useMemo(() => {
    if (selectedWeek <= 0) return courses;
    return courses.filter((c) => isCourseActiveInWeek(c, selectedWeek));
  }, [courses, selectedWeek]);

  const examBlocks = useMemo(
    () => computeExamBlocks(examsQuery.data ?? [], periods, currentWeek, selectedWeek),
    [examsQuery.data, periods, currentWeek, selectedWeek],
  );

  const currentWeekday = currentWeek?.weekday ?? 0;

  if (loading && courses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const renderFilterControls = (idPrefix: string) => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-term`}>{t("schedule.termLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-term`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("schedule.termPlaceholder")}
        />
      </Field>
      <Field className="min-w-[16rem]">
        <FieldLabel htmlFor={`${idPrefix}-week`}>{t("schedule.weekLabel")}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => shiftWeek(-1)}
              aria-label={t("schedule.weekPrev")}
            >
              <ChevronLeft />
            </Button>
            <Input
              id={`${idPrefix}-week`}
              type="number"
              value={selectedWeek || ""}
              onChange={(e) => setSelectedWeek(parseInt(e.target.value, 10) || 0)}
              placeholder={t("schedule.weeks")}
              className="w-20 text-center"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => shiftWeek(1)}
              aria-label={t("schedule.weekNext")}
            >
              <ChevronRight />
            </Button>
          </div>
          {currentWeek?.week && (
            <Badge variant="secondary">{t("schedule.currentWeekBadge", { week: currentWeek.week })}</Badge>
          )}
        </div>
      </Field>
      <Button onClick={handleQuery} disabled={loading}>
        {loading ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <Search data-icon="inline-start" />
        )}
        {t("schedule.query")}
      </Button>
    </FieldGroup>
  );

  return (
    <div className={compactMode && isMobile ? "flex flex-1 flex-col min-h-0" : "flex flex-col gap-6"}>
      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>{t("schedule.title")}</CardTitle>
          <CardDescription>{t("schedule.description")}</CardDescription>
        </CardHeader>
        <CardContent>{renderFilterControls("schedule-desktop")}</CardContent>
      </Card>

      {isMobile ? (
        <div
          className={cn(
            "flex flex-col -mx-4 -mt-4 -mb-4 md:m-0",
            compactMode && "flex-1 min-h-0 overflow-hidden",
          )}
          style={compactMode ? undefined : { minHeight: "calc(100dvh - 102px)" }}
        >
          <ScheduleMobile
            courses={filteredCourses}
            examBlocks={examBlocks}
            periods={periods}
            currentWeekday={currentWeekday}
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            nowMinutes={nowMinutes}
            compact={compactMode}
            onPrevWeek={() => shiftWeek(-1)}
            onNextWeek={() => shiftWeek(1)}
          />
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <ScheduleTablet
              courses={filteredCourses}
              periods={periods}
              currentWeekday={currentWeekday}
              currentWeek={currentWeek}
              selectedWeek={selectedWeek}
              nowMinutes={nowMinutes}
            />
          </CardContent>
        </Card>
      )}

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("schedule.title")}
        description={t("schedule.description")}
      >
        {renderFilterControls("schedule-drawer")}
      </FilterDrawer>
    </div>
  );
}
