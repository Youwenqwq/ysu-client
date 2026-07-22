"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/use-translation";
import type { GPAStats } from "@/providers/types";
import { ChevronDown, ChevronUp } from "lucide-react";

/** 燕大满绩（2024 版成绩评定说明：A+ = 4.5）。 */
const GPA_MAX = 4.5;

function toNum(value?: string): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * 燕大 2024 版成绩评定：百分制 - 等级 - 绩点对应表（2024 秋季起）。
 * 平均绩点按同一刻度换算“相当于某档”为客户端诠释，非官方定级。
 */
const GPA_BANDS = [
  { min: 0, letter: "F" },
  { min: 1.2, letter: "D" },
  { min: 1.8, letter: "C-" },
  { min: 2.2, letter: "C" },
  { min: 2.6, letter: "C+" },
  { min: 3.0, letter: "B-" },
  { min: 3.4, letter: "B" },
  { min: 3.8, letter: "B+" },
  { min: 4.0, letter: "A-" },
  { min: 4.3, letter: "A" },
  { min: 4.5, letter: "A+" },
] as const;

function bandOf(gpa: number) {
  let idx = 0;
  for (let i = 0; i < GPA_BANDS.length; i++) {
    if (gpa >= GPA_BANDS[i]!.min) idx = i;
  }
  return idx;
}

/** 等级标尺：尺子按绩点档分段，当前档高亮，指针落在精确位置。 */
function GpaBandRuler({ value }: { value: number }) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.max(0, (value / GPA_MAX) * 100));
  const current = bandOf(value);
  const next = current + 1 < GPA_BANDS.length ? GPA_BANDS[current + 1]! : null;

  const segments = GPA_BANDS.slice(0, -1).map((band, i) => ({
    letter: band.letter,
    widthPct: ((GPA_BANDS[i + 1]!.min - band.min) / GPA_MAX) * 100,
    current: i === current,
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
          {segments.map((seg) => (
            <div
              key={seg.letter}
              className={seg.current ? "bg-primary" : "bg-muted"}
              style={{ width: `${seg.widthPct}%` }}
            />
          ))}
        </div>
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t("gpa.bandEquivalent", { letter: GPA_BANDS[current]!.letter })}
        </span>
        {next ? (
          <span className="tabular-nums">
            {t("gpa.toNextBand", {
              letter: next.letter,
              delta: (next.min - value).toFixed(2),
            })}
          </span>
        ) : (
          <span>{t("gpa.topBand")}</span>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value || "-"}</span>
    </div>
  );
}

interface CreditSegment {
  label: string;
  value: number;
  className: string;
}

export function GpaSummary({
  gpa,
  termWeightedGpa,
}: {
  gpa: GPAStats | undefined;
  termWeightedGpa: string | null;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const credits: CreditSegment[] = (
    [
      { label: t("gpa.requiredEarned"), raw: gpa?.requiredCreditEarned, className: "bg-chart-4" },
      { label: t("gpa.electiveEarned"), raw: gpa?.electiveCreditEarned, className: "bg-chart-3" },
      { label: t("gpa.degreeEarned"), raw: gpa?.degreeCreditEarned, className: "bg-chart-2" },
    ] as Array<{ label: string; raw?: string; className: string }>
  )
    .map((s) => ({ label: s.label, value: toNum(s.raw) ?? 0, className: s.className }))
    .filter((s) => s.value > 0);
  const totalCredits = credits.reduce((sum, s) => sum + s.value, 0);
  const failedCredits = toNum(gpa?.requiredCreditFailed) ?? 0;

  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm md:text-base">{t("grades.gpaTitle")}</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-3">
        <div className="flex flex-col gap-3">
          {(() => {
            const gpaValue = toNum(gpa?.gpaInitial);
            return (
              <>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-5xl font-semibold tabular-nums leading-none">
                    {gpaValue === null ? "-" : gpaValue.toFixed(2)}
                  </span>
                  {gpaValue !== null && (
                    <Badge variant="secondary" className="mb-1">
                      {GPA_BANDS[bandOf(gpaValue)]!.letter}
                    </Badge>
                  )}
                </div>
                {gpaValue !== null && <GpaBandRuler value={gpaValue} />}
              </>
            );
          })()}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <StatRow label={t("dashboard.weightedAvg")} value={gpa?.weightedAvg} />
            <StatRow label={t("dashboard.arithmeticAvg")} value={gpa?.arithmeticAvg} />
            {termWeightedGpa !== null && (
              <StatRow label={t("grades.termWeightedGpa")} value={termWeightedGpa} />
            )}
            <StatRow label={t("grades.gpaHighest")} value={gpa?.gpaHighest} />
          </div>
        </div>

        {totalCredits > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {credits.map((s) => (
                <div
                  key={s.label}
                  className={s.className}
                  style={{ width: `${(s.value / totalCredits) * 100}%` }}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {credits.map((s) => (
                <span key={s.label} className="flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${s.className}`} />
                  {s.label} <span className="font-semibold text-foreground">{s.value}</span>
                </span>
              ))}
              {failedCredits > 0 && (
                <span className="text-destructive">
                  {t("gpa.requiredFailed")} {failedCredits}
                </span>
              )}
            </div>
          </div>
        )}

        {expanded && (
          <div className="flex flex-col divide-y divide-border border-t pt-1">
            <div className="py-1.5"><StatRow label={t("grades.requiredGpaHighest")} value={gpa?.requiredGpaHighest} /></div>
            <div className="py-1.5"><StatRow label={t("grades.degreeGpaInitial")} value={gpa?.degreeGpaInitial} /></div>
            <div className="py-1.5"><StatRow label={t("gpa.degreeGpaHighest")} value={gpa?.degreeGpaHighest} /></div>
            <div className="py-1.5"><StatRow label={t("grades.degreeWeightedAvg")} value={gpa?.degreeWeightedAvg} /></div>
          </div>
        )}

        {gpa?.planName && (
          <p className="text-xs text-muted-foreground">
            {[gpa.planName, gpa.studyType].filter(Boolean).join(" · ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
