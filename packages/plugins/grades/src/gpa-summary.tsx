import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react"
import type { GPAStats, ProviderGPAScale } from "@orahako/academic-sdk"
import type { Translator } from "@orahako/sdk"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import { gpaBandIndex } from "./gpa-band"
import { resolvePrimaryGpa, type GpaDisplayMode } from "./store"

function toNumber(numericValue: number | undefined, rawText?: string): number | null {
  if (typeof numericValue === "number" && Number.isFinite(numericValue)) {
    return numericValue
  }
  if (!rawText) return null
  const parsed = Number.parseFloat(rawText)
  return Number.isNaN(parsed) ? null : parsed
}

function GpaBandRuler({
  value,
  scale,
  t,
}: {
  readonly value: number
  readonly scale: ProviderGPAScale
  readonly t: Translator<GradesDictionary>
}): ReactNode {
  const pct = Math.min(100, Math.max(0, (value / scale.max) * 100))
  const current = gpaBandIndex(value, scale.bands)
  const next = current + 1 < scale.bands.length ? scale.bands[current + 1]! : null

  const segments = scale.bands.slice(0, -1).map((band, index) => ({
    letter: band.letter,
    widthPct: ((scale.bands[index + 1]!.min - band.min) / scale.max) * 100,
    current: index === current,
  }))

  return (
    <div data-gpa-band-ruler="" className="flex flex-col gap-1.5">
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
        <span>{t("gpa.bandEquivalent", { letter: scale.bands[current]!.letter })}</span>
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
  )
}

function StatRow({ label, value }: { readonly label: string; readonly value?: string }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value || "-"}</span>
    </div>
  )
}

interface CreditSegment {
  readonly label: string
  readonly value: number
  readonly className: string
}

export interface GpaSummaryProps {
  readonly gpa: GPAStats | undefined
  readonly gpaScale?: ProviderGPAScale
  readonly termWeightedGpa: string | null
  readonly gpaVisible: boolean
  readonly gpaDisplayMode?: GpaDisplayMode
  readonly onSetGpaVisible: (visible: boolean) => void
  readonly t: Translator<GradesDictionary>
}

export function GpaSummary({
  gpa,
  gpaScale,
  termWeightedGpa,
  gpaVisible,
  gpaDisplayMode = "initial",
  onSetGpaVisible,
  t,
}: GpaSummaryProps): ReactNode {
  const [expanded, setExpanded] = useState(false)

  const credits: CreditSegment[] = [
    {
      label: t("gpa.requiredEarned"),
      value: toNumber(gpa?.numericRequiredCreditEarned, gpa?.requiredCreditEarned) ?? 0,
      className: "bg-chart-4",
    },
    {
      label: t("gpa.electiveEarned"),
      value: toNumber(gpa?.numericElectiveCreditEarned, gpa?.electiveCreditEarned) ?? 0,
      className: "bg-chart-3",
    },
  ].filter((segment) => segment.value > 0)

  const totalCredits = credits.reduce((sum, segment) => sum + segment.value, 0)
  const failedCredits = toNumber(gpa?.numericRequiredCreditFailed, gpa?.requiredCreditFailed) ?? 0

  const primaryGpa = resolvePrimaryGpa(gpa, gpaDisplayMode)
  const gpaValue = primaryGpa.numeric
  const band =
    gpaValue === null || !gpaScale ? null : gpaScale.bands[gpaBandIndex(gpaValue, gpaScale.bands)]!
  const encourageKey = !band
    ? null
    : band.letter.startsWith("A")
      ? "gpa.encourageA"
      : band.letter.startsWith("B")
        ? "gpa.encourageB"
        : band.letter.startsWith("C")
          ? "gpa.encourageC"
          : "gpa.encourageLow"

  return (
    <Card data-gpa-summary="">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm md:text-base">{t("grades.gpaTitle")}</CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!expanded) onSetGpaVisible(true)
              setExpanded((prev) => !prev)
            }}
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-3">
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-end gap-2">
            <span className="text-5xl leading-none font-semibold tabular-nums">
              {gpaVisible && gpaValue !== null ? gpaValue.toFixed(2) : "***"}
            </span>
            <button
              type="button"
              onClick={() => onSetGpaVisible(!gpaVisible)}
              aria-label={t("gpa.toggleVisibility")}
              className="mb-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              {gpaVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {gpaVisible && band && (
            <Badge variant="secondary" className="mb-1">
              {band.letter}
            </Badge>
          )}
        </div>

        {gpaVisible && gpaValue !== null && gpaScale && (
          <GpaBandRuler value={gpaValue} scale={gpaScale} t={t} />
        )}

        {gpaVisible && encourageKey && (
          <p className="text-sm text-muted-foreground">{t(encourageKey)}</p>
        )}

        {failedCredits > 0 && (
          <p className="text-sm text-destructive">
            {t("gpa.requiredFailed")} {failedCredits}
          </p>
        )}

        {expanded && (
          <>
            <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-sm text-muted-foreground">
              <span>
                {t("grades.weightedAvg")}{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {gpa?.weightedAvg || "-"}
                </span>
              </span>
              <span>
                {t("grades.arithmeticAvg")}{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {gpa?.arithmeticAvg || "-"}
                </span>
              </span>
              {termWeightedGpa !== null && (
                <span>
                  {t("grades.termWeightedGpa")}{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {termWeightedGpa}
                  </span>
                </span>
              )}
            </div>

            {totalCredits > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {credits.map((segment) => (
                    <div
                      key={segment.label}
                      className={segment.className}
                      style={{ width: `${(segment.value / totalCredits) * 100}%` }}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("gpa.totalEarned")}{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {totalCredits.toFixed(1)}
                  </span>
                </span>
              </div>
            )}

            <div className="flex flex-col divide-y divide-border">
              <div className="py-1.5">
                {primaryGpa.mode === "highest" ? (
                  <StatRow label={t("grades.gpaInitial")} value={gpa?.gpaInitial} />
                ) : (
                  <StatRow label={t("grades.gpaHighest")} value={gpa?.gpaHighest} />
                )}
              </div>
              <div className="py-1.5">
                <StatRow label={t("grades.requiredGpaHighest")} value={gpa?.requiredGpaHighest} />
              </div>
              <div className="py-1.5">
                <StatRow label={t("grades.degreeGpaInitial")} value={gpa?.degreeGpaInitial} />
              </div>
              <div className="py-1.5">
                <StatRow label={t("gpa.degreeGpaHighest")} value={gpa?.degreeGpaHighest} />
              </div>
              <div className="py-1.5">
                <StatRow label={t("grades.degreeWeightedAvg")} value={gpa?.degreeWeightedAvg} />
              </div>
              <div className="py-1.5">
                <StatRow label={t("gpa.degreeEarned")} value={gpa?.degreeCreditEarned} />
              </div>
              {credits.map((segment) => (
                <div
                  key={segment.label}
                  className="flex items-baseline justify-between gap-2 py-1.5"
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`size-2 rounded-full ${segment.className}`} />
                    {segment.label}
                  </span>
                  <span className="text-base font-semibold tabular-nums">{segment.value}</span>
                </div>
              ))}
            </div>

            {gpa?.planName && (
              <p className="text-xs text-muted-foreground">
                {[gpa.planName, gpa.studyType].filter(Boolean).join(" · ")}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
