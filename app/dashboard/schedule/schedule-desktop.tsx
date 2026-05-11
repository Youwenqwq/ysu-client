"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { Course, ClassPeriod } from "@/lib/types";
import { computeMergedBlocks, type ScheduleBlock } from "./schedule-utils";

interface Props {
  courses: Course[];
  periods: ClassPeriod[];
  currentWeekday: number;
}

export function ScheduleDesktop({ courses, periods, currentWeekday }: Props) {
  const { t } = useTranslation();
  const [overlapDialog, setOverlapDialog] = useState<{ day: number; section: number; courses: Course[] } | null>(null);

  const WEEKDAYS = [
    "",
    t("dashboard.weekdayNames.1"),
    t("dashboard.weekdayNames.2"),
    t("dashboard.weekdayNames.3"),
    t("dashboard.weekdayNames.4"),
    t("dashboard.weekdayNames.5"),
    t("dashboard.weekdayNames.6"),
    t("dashboard.weekdayNames.7"),
  ];

  const mergedBlocks = useMemo(() => computeMergedBlocks(courses, periods), [courses, periods]);

  function blockStyle(block: ScheduleBlock) {
    const rowStart = periods.findIndex((p) => p.section === block.start) + 2;
    const rowEnd = periods.findIndex((p) => p.section === block.end) + 3;
    const colStart = block.day + 1;
    return {
      gridRow: `${rowStart} / ${rowEnd}`,
      gridColumn: `${colStart}`,
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
          className="grid"
          style={{
            gridTemplateColumns: `80px repeat(7, minmax(140px, 1fr))`,
            gridTemplateRows: `auto repeat(${periods.length}, minmax(60px, auto))`,
          }}
        >
          <div className="border p-2 text-sm font-medium bg-muted/50">{t("schedule.sections")}</div>
          {WEEKDAYS.slice(1).map((d, idx) => (
            <div
              key={d}
              className={`border p-2 text-center text-sm font-medium ${
                idx + 1 === currentWeekday ? "bg-primary/10 text-primary" : "bg-muted/50"
              }`}
            >
              {d}
            </div>
          ))}

          {periods.map((p) => (
            <div
              key={p.section}
              className="border p-2 text-xs text-muted-foreground flex flex-col justify-center"
              style={{ gridColumn: 1 }}
            >
              <span className="font-medium text-foreground">
                {p.name || t("dashboard.sectionRange", { start: p.section, end: p.section })}
              </span>
              <span>
                {p.start_time}-{p.end_time}
              </span>
            </div>
          ))}

          {mergedBlocks.map((block, idx) => (
            <div
              key={idx}
              className={`border p-1 ${block.day === currentWeekday ? "bg-primary/5" : ""}`}
              style={blockStyle(block)}
            >
              {block.courses.length === 1 ? (
                <div className="h-full rounded-md bg-primary/10 p-2 flex flex-col justify-center gap-0.5 overflow-hidden">
                  <div className="font-medium text-xs truncate">{block.courses[0].name}</div>
                  <div className="text-xs text-muted-foreground truncate">{block.courses[0].teacher}</div>
                  <div className="text-xs text-muted-foreground truncate">{block.courses[0].classroom}</div>
                  <div className="text-xs text-muted-foreground">{block.courses[0].weeks}</div>
                </div>
              ) : (
                <button
                  className="h-full w-full rounded-md bg-accent p-2 flex flex-col items-center justify-center gap-1 hover:bg-accent/80"
                  onClick={() =>
                    setOverlapDialog({ day: block.day, section: block.start, courses: block.courses })
                  }
                >
                  <Badge variant="secondary">{t("schedule.overlapCourses", { count: block.courses.length })}</Badge>
                  <span className="text-xs text-muted-foreground">{t("schedule.expand")}</span>
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!overlapDialog} onOpenChange={(v) => !v && setOverlapDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {overlapDialog &&
                t("schedule.overlapDialogTitle", {
                  weekday: WEEKDAYS[overlapDialog.day],
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
            {overlapDialog?.courses.map((c, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>
                    {c.teacher} · {c.classroom}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {t("schedule.weeks")}: {c.weeks} · {t("schedule.sections")}: {c.start_section}-{c.end_section}
                </CardContent>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
