import { useMemo, useState, type ReactNode } from "react"
import { AlertTriangle, CheckCircle2, RefreshCw, RotateCcw, Search } from "lucide-react"
import { toast } from "sonner"
import type {
  AcademicCompletion,
  AcademicWarning,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  TrainingPlan,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ResponsiveSelect,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useErrorToast,
} from "@orahako/ui-primitives"
import type { TrainingPlanDictionary } from "./dictionary"

export const FILTER_ALL = "__all__"
export const FILTER_REQUIRED_YES = "__required__"
export const FILTER_REQUIRED_NO = "__elective__"

export interface TrainingPlanFilterInput {
  readonly search: string
  readonly requiredFilter: string
  readonly termFilter: string
  readonly groupFilter: string
}

export function computeCompletionPercentage(data: AcademicCompletion): number | null {
  const total = data.numericTotalRequired ?? 0
  const done = data.numericCompleted ?? 0
  return total > 0 ? Math.min(100, (done / total) * 100) : null
}

export function filterActiveWarnings(warnings: readonly AcademicWarning[]): AcademicWarning[] {
  return warnings.filter((warning) => warning.warningLevel !== "1")
}

export function filterTrainingPlanCourses(
  courses: readonly TrainingPlan[],
  filters: TrainingPlanFilterInput
): TrainingPlan[] {
  const keyword = filters.search.trim().toLowerCase()
  return courses.filter((plan) => {
    if (keyword) {
      const haystack = `${plan.courseName ?? ""} ${plan.courseCode ?? ""}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    if (filters.requiredFilter === FILTER_REQUIRED_YES && !plan.required) return false
    if (filters.requiredFilter === FILTER_REQUIRED_NO && plan.required) return false
    if (filters.termFilter !== FILTER_ALL && plan.term !== filters.termFilter) return false
    if (filters.groupFilter !== FILTER_ALL && plan.courseGroup !== filters.groupFilter) {
      return false
    }
    return true
  })
}

function CompletionHero({
  data,
  t,
}: {
  readonly data: AcademicCompletion
  readonly t: Translator<TrainingPlanDictionary>
}): ReactNode {
  const pct = computeCompletionPercentage(data)

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
        {stats.map((stat) => (
          <span key={stat.label}>
            {stat.label}{" "}
            <span className="font-semibold text-foreground tabular-nums">{stat.value || "-"}</span>
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

export interface TrainingPlanPageInject {
  readonly hooks: {
    readonly plans: ObservableSource<QuerySnapshot<TrainingPlan[]>>
    readonly completion: ObservableSource<QuerySnapshot<AcademicCompletion>>
    readonly warnings: ObservableSource<QuerySnapshot<AcademicWarning[]>>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly recalculateCompletion: () => Promise<AcademicCompletion>
}

export type TrainingPlanPageProps = DerivedComponentProps<
  Record<string, never>,
  TrainingPlanDictionary,
  undefined,
  undefined,
  TrainingPlanPageInject
>

export const TrainingPlanPage: SlotComponent<TrainingPlanPageProps> = (props) => {
  const { t } = props

  const [search, setSearch] = useState("")
  const [requiredFilter, setRequiredFilter] = useState(FILTER_ALL)
  const [termFilter, setTermFilter] = useState(FILTER_ALL)
  const [groupFilter, setGroupFilter] = useState(FILTER_ALL)
  const [recalculating, setRecalculating] = useState(false)

  const plans = props.usePlans()
  const completion = props.useCompletion()
  const warnings = props.useWarnings()
  const canRecalculate = props.useProvider((snap) =>
    Boolean(snap.provider?.slices.trainingPlan?.recalculateAcademicCompletion)
  )

  useErrorToast(plans.error ?? undefined, t("updating"))
  useErrorToast(completion.error ?? undefined, t("updating"))
  useErrorToast(warnings.error ?? undefined, t("updating"))

  const termOptions = useMemo(() => {
    const set = new Set<string>()
    for (const plan of plans.data ?? []) {
      if (plan.term) set.add(plan.term)
    }
    return Array.from(set).sort()
  }, [plans.data])

  const groupOptions = useMemo(() => {
    const set = new Set<string>()
    for (const plan of plans.data ?? []) {
      if (plan.courseGroup) set.add(plan.courseGroup)
    }
    return Array.from(set).sort()
  }, [plans.data])

  const activeWarnings = useMemo(() => filterActiveWarnings(warnings.data ?? []), [warnings.data])

  const filtered = useMemo(
    () =>
      filterTrainingPlanCourses(plans.data ?? [], {
        search,
        requiredFilter,
        termFilter,
        groupFilter,
      }),
    [plans.data, search, requiredFilter, termFilter, groupFilter]
  )

  const hasActiveFilters =
    search.trim() !== "" ||
    requiredFilter !== FILTER_ALL ||
    termFilter !== FILTER_ALL ||
    groupFilter !== FILTER_ALL

  const resetFilters = (): void => {
    setSearch("")
    setRequiredFilter(FILTER_ALL)
    setTermFilter(FILTER_ALL)
    setGroupFilter(FILTER_ALL)
  }

  const handleRecalculate = async (): Promise<void> => {
    if (!canRecalculate) return
    setRecalculating(true)
    try {
      await props.recalculateCompletion()
      toast.success(t("academic.recalcSuccess"))
    } catch (err: unknown) {
      const message = err instanceof Error && err.message ? err.message : t("updating")
      toast.error(message)
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
            {completion.data && canRecalculate && (
              <Button
                variant="ghost"
                size="sm"
                data-training-plan-recalculate=""
                onClick={() => void handleRecalculate()}
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
            <CompletionHero data={completion.data} t={t} />
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
              {activeWarnings.map((warning, idx) => (
                <Alert key={`${warning.warningType}-${idx}`} variant="destructive">
                  <AlertTriangle className="size-4" />
                  <AlertTitle className="flex flex-wrap items-center gap-2">
                    <span>{warning.warningType}</span>
                    {warning.warningLevel && (
                      <Badge variant="destructive">{warning.warningLevel}</Badge>
                    )}
                    {warning.term && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {warning.term}
                      </span>
                    )}
                  </AlertTitle>
                  {warning.description && (
                    <AlertDescription>{warning.description}</AlertDescription>
                  )}
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
                  { value: FILTER_ALL, label: t("trainingPlan.filters.all") },
                  { value: FILTER_REQUIRED_YES, label: t("trainingPlan.filters.requiredOnly") },
                  { value: FILTER_REQUIRED_NO, label: t("trainingPlan.filters.electiveOnly") },
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
                  { value: FILTER_ALL, label: t("trainingPlan.filters.all") },
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
                  { value: FILTER_ALL, label: t("trainingPlan.filters.all") },
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
                  filtered.map((plan, idx) => (
                    <TableRow key={`${plan.courseCode ?? plan.courseName}-${idx}`}>
                      <TableCell className="font-medium">{plan.courseName}</TableCell>
                      <TableCell>{plan.courseCode}</TableCell>
                      <TableCell>{plan.credit}</TableCell>
                      <TableCell>
                        {plan.required ? (
                          <Badge variant="default">{t("trainingPlan.table.requiredYes")}</Badge>
                        ) : (
                          <Badge variant="outline">{t("trainingPlan.table.requiredNo")}</Badge>
                        )}
                      </TableCell>
                      <TableCell>{plan.term}</TableCell>
                      <TableCell>{plan.courseGroup}</TableCell>
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
