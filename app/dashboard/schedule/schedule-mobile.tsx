"use client";

import { useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { CalendarOff, Clock, Layers, MapPin, User } from "lucide-react";
import { useTranslation } from "@/lib/i18n/use-translation";
import { cn } from "@/lib/utils";
import type { ClassPeriod, Course, CurrentWeek } from "@/lib/types";
import { computeMergedBlocks, type ScheduleBlock } from "./schedule-utils";
import { COURSE_BG_CLASSES, courseColorIndex } from "./course-color";

interface Props {
  courses: Course[];
  periods: ClassPeriod[];
  currentWeekday: number;
  currentWeek: CurrentWeek | null;
  selectedWeek: number;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const LUNCH_AFTER = 4;
const DINNER_AFTER = 8;

type OverlapState = { day: number; section: number; courses: Course[] } | null;

function computeWeekDates(currentWeek: CurrentWeek | null, selectedWeek: number): (string | null)[] {
  if (!currentWeek?.date || !currentWeek.week || !currentWeek.weekday) {
    return Array(7).fill(null);
  }
  const base = new Date(currentWeek.date);
  if (Number.isNaN(base.getTime())) return Array(7).fill(null);
  const mondayOffset = currentWeek.weekday - 1;
  const weekDelta = selectedWeek - currentWeek.week;
  const monday = new Date(base);
  monday.setDate(base.getDate() - mondayOffset + weekDelta * 7);
  return DAYS.map((d) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + (d - 1));
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  });
}

export function ScheduleMobile({
  courses,
  periods,
  currentWeekday,
  currentWeek,
  selectedWeek,
  onPrevWeek,
  onNextWeek,
}: Props) {
  const { t } = useTranslation();
  const [detailDrawer, setDetailDrawer] = useState<Course | null>(null);
  const [overlapDrawer, setOverlapDrawer] = useState<OverlapState>(null);
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
    () => computeWeekDates(currentWeek, selectedWeek),
    [currentWeek, selectedWeek],
  );

  const isCurrentWeek = currentWeek?.week === selectedWeek;

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

  const blocks = useMemo(() => computeMergedBlocks(courses, periods), [courses, periods]);

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
          gridTemplateColumns: "minmax(36px, 0.6fr) repeat(7, minmax(0, 1fr))",
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
              {p.start_time && <span>{p.start_time}</span>}
              {p.end_time && <span>{p.end_time}</span>}
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
                  setDetailDrawer(c);
                }}
                className={cn(
                  "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1 text-left transition-opacity active:opacity-60",
                  COURSE_BG_CLASSES[colorIdx],
                )}
                style={blockStyle(block)}
              >
                <span className="line-clamp-4 text-[10.5px] font-medium leading-tight text-foreground">
                  {c.name}
                </span>
                {c.classroom && (
                  <span className="line-clamp-2 text-[9px] leading-tight text-foreground/70">
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

      <Drawer open={!!detailDrawer} onOpenChange={(v) => !v && setDetailDrawer(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{detailDrawer?.name ?? t("schedule.courseDetail")}</DrawerTitle>
            <DrawerDescription>
              {detailDrawer
                ? `${t(`dashboard.weekdayNames.${detailDrawer.week_day}`)} · ${t(
                    "dashboard.sectionRange",
                    { start: detailDrawer.start_section, end: detailDrawer.end_section },
                  )}`
                : ""}
            </DrawerDescription>
          </DrawerHeader>
          {detailDrawer && (
            <div className="flex flex-col gap-3 px-4 pb-6 text-sm">
              {detailDrawer.teacher && (
                <div className="flex items-center gap-2">
                  <User className="size-4 shrink-0 text-muted-foreground" />
                  <span>{detailDrawer.teacher}</span>
                </div>
              )}
              {detailDrawer.classroom && (
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 text-muted-foreground" />
                  <span>{detailDrawer.classroom}</span>
                </div>
              )}
              {detailDrawer.weeks && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {t("schedule.weeks")}: {detailDrawer.weeks}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {detailDrawer.credit && (
                  <Badge variant="outline">
                    {t("schedule.credit")}: {detailDrawer.credit}
                  </Badge>
                )}
                {detailDrawer.course_type && (
                  <Badge variant="outline">{detailDrawer.course_type}</Badge>
                )}
                {detailDrawer.code && (
                  <Badge variant="outline" className="font-mono">
                    {detailDrawer.code}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

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
                    setDetailDrawer(c);
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
    </>
  );
}
