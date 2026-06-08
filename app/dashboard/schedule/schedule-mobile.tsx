"use client";

import { useMemo, useRef, useState } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { CalendarOff, Layers } from "lucide-react";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { ClassPeriod, Course, CurrentWeek } from "@/providers/types";
import {
  computeMergedBlocks,
  buildSectionTimeMap,
  computeWeekDateLabels,
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
  compact?: boolean;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const LUNCH_AFTER = 4;
const DINNER_AFTER = 8;

type OverlapState = { day: number; section: number; courses: Course[] } | null;

export function ScheduleMobile({
  courses,
  periods,
  currentWeekday,
  currentWeek,
  selectedWeek,
  nowMinutes,
  compact = false,
  onPrevWeek,
  onNextWeek,
}: Props) {
  const { t } = useTranslation();
  const [overlapDrawer, setOverlapDrawer] = useState<OverlapState>(null);
  const [activityCourse, setActivityCourse] = useState<Course | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null);
  const [signinType, setSigninType] = useState(1);
  const [signinOpen, setSigninOpen] = useState(false);
  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const end = e.changedTouches[0];
    if (!end) return;
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    const dt = Date.now() - start.time;
    if (dt > 600) return;
    if (Math.abs(dx) < 50) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dx > 0) {
      onPrevWeek?.();
    } else {
      onNextWeek?.();
    }
  }

  const weekDates = useMemo(
    () => computeWeekDateLabels(currentWeek, selectedWeek),
    [currentWeek, selectedWeek],
  );

  const isCurrentWeek = currentWeek?.week === selectedWeek;
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods]);

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
        sizes.push(compact ? "0px" : "18px");
      } else {
        sizes.push(compact ? "minmax(36px, 1fr)" : "minmax(52px, 1fr)");
      }
    }
    return sizes.join(" ");
  }, [totalRows, lunchRow, dinnerRow, compact]);

  const blocks = useMemo(() => computeMergedBlocks(courses, periods), [courses, periods]);

  if (courses.length === 0) {
    return (
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex flex-1 select-none"
      >
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOff />
            </EmptyMedia>
            <EmptyTitle>{t("schedule.noData")}</EmptyTitle>
            <EmptyDescription>{t("schedule.description")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  function blockStyle(block: ScheduleBlock) {
    const startRow = sectionToRow.get(block.start);
    const endRow = sectionToRow.get(block.end);
    if (!startRow || !endRow) return { display: "none" as const };
    return {
      gridRow: `${startRow} / ${endRow + 1}`,
      gridColumn: `${block.day + 1}`,
    };
  }

  return (
    <>
      <div
        key={selectedWeek}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="grid flex-1 w-full select-none animate-in fade-in duration-200"
        style={{
          gridTemplateColumns: compact
              ? "minmax(28px, 0.4fr) repeat(7, minmax(0, 1fr))"
              : "minmax(36px, 0.6fr) repeat(7, minmax(0, 1fr))",
          gridTemplateRows,
        }}
      >
        <div className="border-b border-r border-border" />

        {DAYS.map((d, idx) => (
          <div
            key={d}
            className={cn(
              "flex flex-col items-center justify-center border-b border-border text-[10px] font-medium",
              compact ? "gap-0 py-0.5" : "gap-0.5 py-1.5",
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
              {!compact && periodStartTime(p) && <span>{periodStartTime(p)}</span>}
              {!compact && periodEndTime(p) && <span>{periodEndTime(p)}</span>}
            </div>
          );
        })}

        {lunchRow !== null && !compact && (
          <div
            className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
            style={{ gridRow: lunchRow, gridColumn: "1 / -1" }}
          >
            {t("schedule.lunchBreak")}
          </div>
        )}

        {dinnerRow !== null && !compact && (
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

        {blocks.map((block, idx) => {
          if (block.courses.length === 1) {
            const c = block.courses[0];
            const colorIdx = courseColorIndex(c);
            return (
              <button
                key={`block-${idx}`}
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setActivityCourse(c);
                  setActivityOpen(true);
                }}
                className={cn(
                  "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1 text-left transition-opacity active:opacity-60",
                  COURSE_BG_CLASSES[colorIdx],
                  isBlockCurrent(block) && "ring-1 ring-primary",
                )}
                style={blockStyle(block)}
              >
                <span className="line-clamp-4 text-[10.5px] font-medium leading-tight text-foreground">
                  {c.name}
                </span>
                {c.classroom && (
                  <span className={cn(
                    "text-[9px] leading-tight text-foreground/70",
                    compact ? "line-clamp-3" : "line-clamp-2",
                  )}>
                    {c.classroom}
                  </span>
                )}
                {!compact && c.teacher && (
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
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                setOverlapDrawer({ day: block.day, section: block.start, courses: block.courses });
              }}
              className="relative z-10 m-0.5 flex flex-col items-center justify-center gap-0.5 rounded-md bg-accent p-1 text-center transition-opacity active:opacity-60"
              style={blockStyle(block)}
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

      <Drawer open={!!overlapDrawer} onOpenChange={(v) => !v && setOverlapDrawer(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {overlapDrawer &&
                t("schedule.overlapDialogTitle", {
                  weekday: t(`dashboard.weekdayNames.${overlapDrawer.day}`),
                  section: overlapDrawer.section,
                })}
            </DrawerTitle>
            <DrawerDescription>
              {overlapDrawer
                ? t("schedule.overlapCourses", { count: overlapDrawer.courses.length })
                : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-2 px-4 pb-6">
            {overlapDrawer?.courses.map((c, i) => {
              const colorIdx = courseColorIndex(c);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    setOverlapDrawer(null);
                    setActivityCourse(c);
                    setActivityOpen(true);
                  }}
                  className={cn(
                    "flex flex-col gap-1 rounded-lg p-3 text-left transition-opacity active:opacity-60",
                    COURSE_BG_CLASSES[colorIdx],
                  )}
                >
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  {(c.teacher || c.classroom) && (
                    <span className="text-xs text-foreground/70">
                      {[c.teacher, c.classroom].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </DrawerContent>
      </Drawer>

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
