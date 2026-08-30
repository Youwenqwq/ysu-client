"use client"

import { ResponsiveSelect } from "@/components/responsive-select"
import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useTranslation } from "@/lib/i18n/use-translation"
import { toast } from "sonner"
import { useProvider } from "@/providers/use-provider"
import { Spinner } from "@/components/ui/spinner"
import type { AcademicCompletion } from "@/providers/types"
import { useAcademicCompletion, useAcademicWarnings, useTrainingPlan } from "@/providers/hooks"
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Search } from "lucide-react"

const ALL = "__all__"
const REQUIRED_YES = "__required__"
const REQUIRED_NO = "__elective__"

/** 学业完成 hero：巨型完成度百分比 + 细进度轨，安静的学分数据行。 */
function CompletionHero({ data }: { data: AcademicCompletion }) {
  const { t } = useTranslation()
  const total = data.numericTotalRequired ?? 0
  const done = data.numericCompleted ?? 0
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : null

  const stats = [
    { label: t("academic.completed"), value: data.completed },
    { label: t("academic.totalRequired"), value: data.totalRequired },
    { label: t("academic.elective"), value: data.elective },
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-2">
        {pct !== null ? (
          <span className="text-5xl leading-none font-semibold tabular-nums">
            {pct.toFixed(1)}
            <span className="text-xl font-normal text-muted-foreground">%</span>
          </span>
        ) : (
          <span className="text-5xl leading-none font-semibold tabular-nums">
            {data.completed || "-"}
          </span>
        )}
        {data.passed && (
          <Badge variant="default" className="mb-1 gap-1">
            <CheckCircle2 className="size-3" />
            {t("academic.passed")}
          </Badge>
        )}
      </div>

      {pct !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
        {stats.map((s) => (
          <span key={s.label}>
            {s.label}{" "}
            <span className="font-semibold text-foreground tabular-nums">{s.value || "-"}</span>
          </span>
        ))}
      </div>

      {data.planName && <p className="text-xs text-muted-foreground">{data.planName}</p>}
      {data.lastCalculatedAt && (
        <p className="text-xs text-muted-foreground">
          {t("academic.lastCalculated", {
            time: data.lastCalculatedAt.replace("T", " ").slice(0, 16),
          })}
        </p>
      )}
    </div>
  )
}

export default function TrainingPlanPage() {
  const { t } = useTranslation()

  const [search, setSearch] = useState("")
  const [requiredFilter, setRequiredFilter] = useState(ALL)
  const [termFilter, setTermFilter] = useState(ALL)
  const [groupFilter, setGroupFilter] = useState(ALL)
  const [recalculating, setRecalculating] = useState(false)

  const provider = useProvider()

  const plans = useTrainingPlan()
  const completion = useAcademicCompletion()
  const warnings = useAcademicWarnings()

  const termOptions = useMemo(
    () =>
      Array.from(new Set((plans.data ?? []).map((p) => p.term).filter(Boolean) as string[])).sort(),
    [plans.data]
  )
  const groupOptions = useMemo(
    () =>
      Array.from(
        new Set((plans.data ?? []).map((p) => p.courseGroup).filter(Boolean) as string[])
      ).sort(),
    [plans.data]
  )

  const activeWarnings = useMemo(
    () => (warnings.data ?? []).filter((w) => w.warningLevel !== "1"),
    [warnings.data]
  )

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    return (plans.data ?? []).filter((p) => {
      if (keyword) {
        const haystack = `${p.courseName ?? ""} ${p.courseCode ?? ""}`.toLowerCase()
        if (!haystack.includes(keyword)) return false
      }
      if (requiredFilter === REQUIRED_YES && !p.required) return false
      if (requiredFilter === REQUIRED_NO && p.required) return false
      if (termFilter !== ALL && p.term !== termFilter) return false
      if (groupFilter !== ALL && p.courseGroup !== groupFilter) return false
      return true
    })
  }, [plans.data, search, requiredFilter, termFilter, groupFilter])

  const hasActiveFilters =
    search.trim() !== "" || requiredFilter !== ALL || termFilter !== ALL || groupFilter !== ALL

  function resetFilters() {
    setSearch("")
    setRequiredFilter(ALL)
    setTermFilter(ALL)
    setGroupFilter(ALL)
  }

  async function handleRecalculate() {
    if (!provider.recalculateAcademicCompletion) return
    setRecalculating(true)
    try {
      await provider.recalculateAcademicCompletion()
      await completion.mutate()
      toast.success(t("academic.recalcSuccess"))
    } catch (e) {
      toast.error((e as Error).message || t("app.updating"))
    } finally {
      setRecalculating(false)
    }
  }

  if (plans.isLoading && !plans.data && !completion.data) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>{t("academic.completionTitle")}</CardTitle>
              <CardDescription>{t("academic.completionDescription")}</CardDescription>
            </div>
            {completion.data && provider.recalculateAcademicCompletion && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRecalculate}
                disabled={recalculating}
              >
                {recalculating ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                {t("academic.recalculate")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {completion.data ? (
            <CompletionHero data={completion.data} />
          ) : (
            <p className="text-muted-foreground">{t("academic.noCompletionData")}</p>
          )}

          {activeWarnings.length === 0 ? (
            <Alert className="mt-4">
              <CheckCircle2 className="size-4" />
              <AlertTitle>{t("academic.noWarnings")}</AlertTitle>
              <AlertDescription>{t("academic.noWarningsDesc")}</AlertDescription>
            </Alert>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {activeWarnings.map((w, idx) => (
                <Alert key={idx} variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="flex flex-wrap items-center gap-2">
                    <span>{w.warningType}</span>
                    {w.warningLevel && <Badge variant="destructive">{w.warningLevel}</Badge>}
                    {w.term && (
                      <span className="text-xs font-normal text-muted-foreground">{w.term}</span>
                    )}
                  </AlertTitle>
                  {w.description && <AlertDescription>{w.description}</AlertDescription>}
                </Alert>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>{t("trainingPlan.coursesTitle")}</CardTitle>
              <CardDescription>{t("trainingPlan.coursesDescription")}</CardDescription>
            </div>
            <Badge variant="secondary">
              {hasActiveFilters
                ? t("trainingPlan.filters.filteredCount", {
                    filtered: filtered.length,
                    total: plans.data?.length ?? 0,
                  })
                : t("trainingPlan.filters.activeCount", {
                    count: plans.data?.length ?? 0,
                  })}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="tp-search" className="text-xs font-medium text-muted-foreground">
                {t("trainingPlan.filters.searchLabel")}
              </FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  id="tp-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("trainingPlan.filters.searchPlaceholder")}
                />
              </InputGroup>
            </Field>

            <Field>
              <FieldLabel
                htmlFor="tp-required"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("trainingPlan.filters.requiredLabel")}
              </FieldLabel>
              <ResponsiveSelect
                id="tp-required"
                value={requiredFilter}
                onValueChange={setRequiredFilter}
                title={t("trainingPlan.filters.requiredLabel")}
                items={[
                  { value: ALL, label: t("trainingPlan.filters.all") },
                  {
                    value: REQUIRED_YES,
                    label: t("trainingPlan.filters.requiredOnly"),
                  },
                  {
                    value: REQUIRED_NO,
                    label: t("trainingPlan.filters.electiveOnly"),
                  },
                ]}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="tp-term" className="text-xs font-medium text-muted-foreground">
                {t("trainingPlan.filters.termLabel")}
              </FieldLabel>
              <ResponsiveSelect
                id="tp-term"
                value={termFilter}
                onValueChange={setTermFilter}
                title={t("trainingPlan.filters.termLabel")}
                items={[
                  { value: ALL, label: t("trainingPlan.filters.all") },
                  ...termOptions.map((opt) => ({ value: opt, label: opt })),
                ]}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="tp-group" className="text-xs font-medium text-muted-foreground">
                {t("trainingPlan.filters.groupLabel")}
              </FieldLabel>
              <ResponsiveSelect
                id="tp-group"
                value={groupFilter}
                onValueChange={setGroupFilter}
                title={t("trainingPlan.filters.groupLabel")}
                items={[
                  { value: ALL, label: t("trainingPlan.filters.all") },
                  ...groupOptions.map((opt) => ({ value: opt, label: opt })),
                ]}
              />
            </Field>
          </FieldGroup>

          {hasActiveFilters && (
            <div className="flex animate-in justify-end duration-200 fade-in slide-in-from-top-1">
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                <RotateCcw data-icon="inline-start" />
                {t("trainingPlan.filters.reset")}
              </Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("trainingPlan.table.courseName")}</TableHead>
                  <TableHead>{t("trainingPlan.table.courseCode")}</TableHead>
                  <TableHead>{t("trainingPlan.table.credit")}</TableHead>
                  <TableHead>{t("trainingPlan.table.required")}</TableHead>
                  <TableHead>{t("trainingPlan.table.term")}</TableHead>
                  <TableHead>{t("trainingPlan.table.group")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      {(plans.data?.length ?? 0) === 0
                        ? t("trainingPlan.table.noData")
                        : t("trainingPlan.table.noMatch")}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((p, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{p.courseName}</TableCell>
                      <TableCell>{p.courseCode}</TableCell>
                      <TableCell>{p.credit}</TableCell>
                      <TableCell>
                        {p.required ? (
                          <Badge variant="default">{t("trainingPlan.table.requiredYes")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("trainingPlan.table.requiredNo")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{p.term}</TableCell>
                      <TableCell>{p.courseGroup}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
