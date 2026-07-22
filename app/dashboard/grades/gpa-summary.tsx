"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/** GPA 仪表环：主色弧线表示 绩点/4.5，中心大数字。 */
function GpaRing({ value }: { value: number | null }) {
  const pct = value === null ? 0 : Math.min(1, Math.max(0, value / GPA_MAX));
  const r = 46;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="relative size-28 shrink-0">
      <svg viewBox="0 0 112 112" className="size-full -rotate-90">
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          strokeWidth="9"
          className="stroke-muted"
        />
        <circle
          cx="56"
          cy="56"
          r={r}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums leading-none">
          {value === null ? "-" : value.toFixed(2)}
        </span>
        <span className="mt-1 text-[10px] text-muted-foreground">/ {GPA_MAX}</span>
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
        <div className="flex items-center gap-5">
          <GpaRing value={toNum(gpa?.gpaInitial)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
