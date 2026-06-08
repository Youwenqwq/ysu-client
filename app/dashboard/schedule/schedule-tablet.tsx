"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarOff, Layers } from "lucide-react";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { Course, ClassPeriod, CurrentWeek } from "@/providers/types";
import {
  computeMergedBlocks,
  buildSectionTimeMap,
  computeWeekDateLabels,
  courseEndSection,
  courseStartSection,
  isCourseCurrent,
  periodEndTime,
  periodStartTime,
  type ScheduleBlock,
} from "./schedule-utils";
import { COURSE_BG_CLASSES, courseColorIndex } from "./course-color";
import { ActivityModal } from "./activity-modal";
import { SigninModal } from "./signin-modal";

interface Props {
  courses: Course[];
  periods: ClassPeriod[];
  currentWeekday: number;
  currentWeek: CurrentWeek | null;
  selectedWeek: number;
  nowMinutes: number;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const LUNCH_AFTER = 4;
const DINNER_AFTER = 8;

export function ScheduleTablet({ courses, periods, currentWeekday, currentWeek, selectedWeek, nowMinutes }: Props) {
  const { t } = useTranslation();
  const [overlapDialog, setOverlapDialog] = useState<{ day: number; section: number; courses: Course[] } | null>(null);
  const [activityCourse, setActivityCourse] = useState<Course | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null);
  const [signinType, setSigninType] = useState(1);
  const [signinOpen, setSigninOpen] = useState(false);

  const isCurrentWeek = currentWeek?.week === selectedWeek;
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods]);
  const weekDates = useMemo(() => computeWeekDateLabels(currentWeek, selectedWeek), [currentWeek, selectedWeek]);

  const isBlockCurrent = (block: ScheduleBlock): boolean => {
    if (!isCurrentWeek || block.day !== currentWeek?.weekday) return false;
    if (block.courses.length !== 1) return false;
    return isCourseCurrent(block.courses[0], nowMinutes, timeMap);
  };

  const { sectionToRow, totalRows, lunchRow, dinnerRow } = useMemo(() => {
    const map = new Map<number, number>();
    let row = 2;
    let lunch: number | null = null;
    let dinner: number | null = null;
    const sectionSet = new Set(periods.map((p) => p.section));
    for (const p of periods) {
      if (p.section === LUNCH_AFTER + 1 && sectionSet.has(LUNCH_AFTER)) {
        lunch = row;
        row++;
      }
      if (p.section === DINNER_AFTER + 1 && sectionSet.has(DINNER_AFTER)) {
        dinner = row;
        row++;
      }
      map.set(p.section, row);
      row++;
    }
    return { sectionToRow: map, totalRows: row - 1, lunchRow: lunch, dinnerRow: dinner };
  }, [periods]);

  const gridTemplateRows = useMemo(() => {
    const sizes: string[] = ["auto"];
    for (let r = 2; r <= totalRows; r++) {
      if (r === lunchRow || r === dinnerRow) {
        sizes.push("18px");
      } else {
        sizes.push("minmax(52px, 1fr)");
      }
    }
    return sizes.join(" ");
  }, [totalRows, lunchRow, dinnerRow]);

  const mergedBlocks = useMemo(() => computeMergedBlocks(courses, periods), [courses, periods]);

  function blockStyle(block: ScheduleBlock) {
    const startRow = sectionToRow.get(block.start);
    const endRow = sectionToRow.get(block.end);
    if (!startRow || !endRow) return { display: "none" as const };
    return {
      gridRow: `${startRow} / ${endRow + 1}`,
      gridColumn: `${block.day + 1}`,
    };
  }

  if (courses.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarOff />
          </EmptyMedia>
          <EmptyTitle>{t("schedule.noData")}</EmptyTitle>
          <EmptyDescription>{t("schedule.description")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="overflow-auto">
        <div
          className="grid w-full"
          style={{
            gridTemplateColumns: `minmax(48px, 0.4fr) repeat(7, minmax(0, 1fr))`,
            gridTemplateRows,
          }}
        >
          <div className="border-b border-r border-border" />

          {DAYS.map((d, idx) => (
            <div
              key={d}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 border-b border-border py-1.5 text-[10px] font-medium",
                idx < 6 && "border-r",
                isCurrentWeek && d === currentWeekday
                  ? "bg-primary/5 text-primary"
                  : "text-muted-foreground",
              )}
            >
              <span className="text-[11px]">{t(`dashboard.weekdayShort.${d}`)}</span>
              {weekDates[d - 1] && (
                <span className="text-[9px] opacity-70">{weekDates[d - 1]}</span>
              )}
            </div>
          ))}

          {periods.map((p) => {
            const row = sectionToRow.get(p.section);
            if (!row) return null;
            return (
              <div
                key={p.section}
                className="flex flex-col items-center justify-center gap-0.5 border-r border-b border-border py-1 text-[9px] leading-tight text-muted-foreground"
                style={{ gridRow: row, gridColumn: 1 }}
              >
                <span className="text-xs font-semibold text-foreground">{p.section}</span>
                {periodStartTime(p) && <span>{periodStartTime(p)}</span>}
                {periodEndTime(p) && <span>{periodEndTime(p)}</span>}
              </div>
            );
          })}

          {lunchRow !== null && (
            <div
              className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
              style={{ gridRow: lunchRow, gridColumn: "1 / -1" }}
            >
              {t("schedule.lunchBreak")}
            </div>
          )}

          {dinnerRow !== null && (
            <div
              className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
              style={{ gridRow: dinnerRow, gridColumn: "1 / -1" }}
            >
              {t("schedule.dinnerBreak")}
            </div>
          )}

          {DAYS.flatMap((d) =>
            periods.map((p) => {
              const row = sectionToRow.get(p.section);
              if (!row) return null;
              return (
                <div
                  key={`cell-${d}-${p.section}`}
                  className={cn(
                    "border-b border-border",
                    d < 7 && "border-r",
                    isCurrentWeek && d === currentWeekday && "bg-primary/5",
                  )}
                  style={{ gridRow: row, gridColumn: d + 1 }}
                />
              );
            }),
          )}

          {mergedBlocks.map((block, idx) => {
            if (block.courses.length === 1) {
              const c = block.courses[0];
              const colorIdx = courseColorIndex(c);
              return (
                <button
                  key={`block-${idx}`}
                  className={cn(
                    "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1.5 text-left transition-opacity active:opacity-60",
                    COURSE_BG_CLASSES[colorIdx],
                    isBlockCurrent(block) && "ring-1 ring-primary",
                  )}
                  style={blockStyle(block)}
                  onClick={() => {
                    setActivityCourse(c);
                    setActivityOpen(true);
                  }}
                >
                  <span className="line-clamp-3 text-[11px] font-medium leading-tight text-foreground">
                    {c.name}
                  </span>
                  {c.classroom && (
                    <span className="line-clamp-1 text-[9px] leading-tight text-foreground/70">
                      {c.classroom}
                    </span>
                  )}
                  {c.teacher && (
                    <span className="line-clamp-1 text-[9px] leading-tight text-foreground/60">
                      {c.teacher}
                    </span>
                  )}
                </button>
              );
            }
            return (
              <button
                key={`block-${idx}`}
                className="relative z-10 m-0.5 flex flex-col items-center justify-center gap-0.5 rounded-md bg-accent p-1 text-center transition-opacity active:opacity-60"
                style={blockStyle(block)}
                onClick={() =>
                  setOverlapDialog({ day: block.day, section: block.start, courses: block.courses })
                }
              >
                <Layers className="size-3 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">
                  {block.courses.length}
                </span>
                <span className="text-[9px] text-muted-foreground">{t("schedule.overlap")}</span>
              </button>
            );
          })}
        </div>
      </div>

      <Dialog open={!!overlapDialog} onOpenChange={(v) => !v && setOverlapDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {overlapDialog &&
                t("schedule.overlapDialogTitle", {
                  weekday: t(`dashboard.weekdayNames.${overlapDialog.day}`),
                  section: overlapDialog.section,
                })}
            </DialogTitle>
            <DialogDescription>
              {overlapDialog
                ? t("schedule.overlapCourses", { count: overlapDialog.courses.length })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {overlapDialog?.courses.map((c, i) => {
              return (
                <Card
                  key={i}
                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                  onClick={() => {
                    setOverlapDialog(null);
                    setActivityCourse(c);
                    setActivityOpen(true);
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <CardDescription>
                      {c.teacher} · {c.classroom}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t("schedule.weeks")}: {c.weeks} · {t("schedule.sections")}: {courseStartSection(c)}-{courseEndSection(c)}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      <ActivityModal
        course={activityCourse}
        week={selectedWeek}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onSigninActivity={(id, type) => {
          setSigninActivityId(id);
          setSigninType(type);
          setSigninOpen(true);
        }}
      />

      <SigninModal
        activityId={signinActivityId}
        signinType={signinType}
        open={signinOpen}
        onOpenChange={setSigninOpen}
      />
    </>
  );
}
