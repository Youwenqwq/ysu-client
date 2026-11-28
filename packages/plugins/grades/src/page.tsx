import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Dices, Search } from "lucide-react"
import { toast } from "sonner"
import type {
  CurrentWeek,
  GPAStats,
  Grade,
  GradeAnalyticsQueryOptions,
  GradeDistribution,
  GradeRanking,
  GradeStatistics,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  SessionSnapshot,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
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
  FilterDrawer,
  Input,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveSelect,
  Separator,
  Skeleton,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import { GpaSummary } from "./gpa-summary"
import { GradeGachaModal } from "./grade-gacha"
import {
  ALL_TERM,
  gradeKey,
  isGradeScored,
  normalizeGradeUser,
  toPendingGrade,
  type GradeGachaState,
  type GradesSettingsStoreInstance,
  type GradesViewState,
  type GradesViewStoreInstance,
  type PendingGrade,
} from "./store"

const ALL_COURSE_TYPE = "__all_type__"

function numericValue(value: number | undefined, fallback?: string): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const parsed = Number(fallback)
  return Number.isFinite(parsed) ? parsed : undefined
}

function scorePercentOf(grade: Grade): number | undefined {
  const score = numericValue(grade.numericScore, grade.score)
  if (score === undefined) return undefined
  return Math.max(0, Math.min(100, score))
}

export interface GradeAnalyticsResult {
  readonly statistics: GradeStatistics | null
  readonly distribution: GradeDistribution[] | null
  readonly ranking: GradeRanking | null
}

export interface GradesPageInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly grades: ObservableSource<QuerySnapshot<Grade[]>>
    readonly gpa: ObservableSource<QuerySnapshot<GPAStats>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly gacha: ObservableSource<GradeGachaState>
    readonly gachaHydrated: ObservableSource<boolean>
    readonly view: ObservableSource<GradesViewState>
  }
  readonly viewActions: GradesViewStoreInstance["actions"]
  readonly searchByCourseName: (courseName: string) => Promise<void>
  readonly fetchGradeAnalytics: (
    params: GradeAnalyticsQueryOptions
  ) => Promise<GradeAnalyticsResult>
  readonly stageGachaGrades: (
    username: string | null | undefined,
    grades: readonly Grade[],
    gachaEnabled: boolean
  ) => void
  readonly commitGachaPending: (username: string | null | undefined) => void
}

export type GradesPageProps = DerivedComponentProps<
  Record<string, never>,
  GradesDictionary,
  undefined,
  GradesSettingsStoreInstance,
  GradesPageInject
>

export const GradesPage: SlotComponent<GradesPageProps> = (props) => {
  const { t, useStore, actions } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const gradesQuery = props.useGrades()
  const gpaQuery = props.useGpa()
  const currentWeekQuery = props.useCurrentWeek()
  const gachaState = props.useGacha()
  const gachaHydrated = props.useGachaHydrated()

  const gpaVisible = useStore((s) => s.gpaVisible)
  const gpaDisplayMode = useStore((s) => s.gpaDisplayMode)
  const gachaEnabled = useStore((s) => s.gradeGachaEnabled)

  const { term, sortMode, filterDrawerOpen } = props.useView()
  const { setTerm, setDefaultTerm, setSortMode, setFilterDrawerOpen, reset } = props.viewActions
  const [courseType, setCourseType] = useState(ALL_COURSE_TYPE)
  const [courseName, setCourseName] = useState("")
  const [queriedCourseName, setQueriedCourseName] = useState("")
  const [selectedGrade, setSelectedGrade] = useState<Grade | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsResult, setStatsResult] = useState<GradeStatistics | null>(null)
  const [distributionResult, setDistributionResult] = useState<GradeDistribution[] | null>(null)
  const [rankingResult, setRankingResult] = useState<GradeRanking | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsScope, setStatsScope] = useState<"class" | "course">("class")
  const [gachaOpen, setGachaOpen] = useState(false)
  const [playItems, setPlayItems] = useState<PendingGrade[] | null>(null)
  const didAutoSelectTerm = useRef(false)

  useEffect(() => {
    return () => {
      didAutoSelectTerm.current = false
      reset()
    }
  }, [reset])

  const activeGradesSlice = providerSnap.provider?.slices.grades
  const gpaScale = activeGradesSlice?.gpaScale
  const gradeScale = activeGradesSlice?.gradeScale
  const supportsAnalytics = Boolean(
    activeGradesSlice?.getGradeStatistics ||
    activeGradesSlice?.getGradeDistribution ||
    activeGradesSlice?.getGradeRanking
  )

  const grades = useMemo(() => gradesQuery.data ?? [], [gradesQuery.data])
  const loading = gradesQuery.isLoading || gradesQuery.isRefreshing

  const activeUser = normalizeGradeUser(session.username)
  const gachaPending = useMemo(
    () => gachaState.pendingByUser[activeUser] ?? [],
    [gachaState.pendingByUser, activeUser]
  )

  const { stageGachaGrades } = props
  useEffect(() => {
    if (!gachaHydrated || gradesQuery.data === undefined || queriedCourseName) return
    stageGachaGrades(session.username, gradesQuery.data, gachaEnabled)
  }, [
    gradesQuery.data,
    gachaHydrated,
    gachaEnabled,
    queriedCourseName,
    session.username,
    stageGachaGrades,
  ])

  useEffect(() => {
    if (gachaEnabled && gachaPending.length > 0) {
      setGachaOpen(true)
    }
  }, [gachaEnabled, gachaPending.length])

  const pendingKeys = useMemo(() => new Set(gachaPending.map((item) => item.key)), [gachaPending])

  const displayGrades = useMemo(
    () =>
      gachaEnabled && gachaPending.length > 0
        ? grades.filter((grade) => !pendingKeys.has(gradeKey(grade)))
        : grades,
    [grades, gachaEnabled, gachaPending.length, pendingKeys]
  )

  const scoredGrades = useMemo(() => displayGrades.filter(isGradeScored), [displayGrades])

  function handlePlayDraw(): void {
    setFilterDrawerOpen(false)
    const count = 1 + (Math.random() < 0.35 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0)
    const pool = [...scoredGrades]
    const picks: PendingGrade[] = []
    while (picks.length < count && pool.length > 0) {
      const [picked] = pool.splice(Math.floor(Math.random() * pool.length), 1)
      if (picked) {
        picks.push(toPendingGrade(picked))
      }
    }
    if (picks.length > 0) setPlayItems(picks)
  }

  const terms = useMemo(
    () =>
      Array.from(
        new Set(
          displayGrades.map((grade) => grade.semester).filter((sem): sem is string => Boolean(sem))
        )
      ).sort(),
    [displayGrades]
  )

  const courseTypes = useMemo(
    () =>
      Array.from(
        new Set(
          displayGrades
            .map((grade) => grade.courseType)
            .filter((item): item is string => Boolean(item))
        )
      ).sort(),
    [displayGrades]
  )

  useEffect(() => {
    const errors = [gradesQuery.error, gpaQuery.error, currentWeekQuery.error].filter(Boolean)
    if (errors.length === 0) return
    toast.error(errors[0]?.message || t("updating"))
  }, [gradesQuery.error, gpaQuery.error, currentWeekQuery.error, t])

  useEffect(() => {
    const sem = currentWeekQuery.data?.semester
    if (sem) setDefaultTerm(sem)
  }, [currentWeekQuery.data, setDefaultTerm])

  useEffect(() => {
    if (terms.length > 0 && term === ALL_TERM && !didAutoSelectTerm.current) {
      didAutoSelectTerm.current = true
      const latest = terms[terms.length - 1]
      if (latest) setTerm(latest)
    }
  }, [terms, term, setTerm])

  async function handleSearch(): Promise<void> {
    const nextCourseName = courseName.trim()
    setQueriedCourseName(nextCourseName)
    await props.searchByCourseName(nextCourseName)
  }

  async function fetchStatsForScope(grade: Grade, scope: "class" | "course"): Promise<void> {
    setStatsResult(null)
    setDistributionResult(null)
    setRankingResult(null)
    setStatsError(null)

    const params: GradeAnalyticsQueryOptions = {
      semester: grade.semester || undefined,
      classId: scope === "class" ? grade.classId?.trim() : undefined,
      courseCode: scope === "course" ? grade.courseCode?.trim() : undefined,
    }

    setStatsLoading(true)
    try {
      const result = await props.fetchGradeAnalytics(params)
      setStatsResult(result.statistics)
      setDistributionResult(result.distribution)
      setRankingResult(result.ranking)
      if (!result.statistics && !result.distribution && !result.ranking) {
        setStatsError(t("grades.stats.loadFailed"))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      setStatsError(message || t("grades.stats.loadFailed"))
    } finally {
      setStatsLoading(false)
    }
  }

  async function handleOpenGradeDetail(grade: Grade): Promise<void> {
    setSelectedGrade(grade)
    setDetailOpen(true)
    setStatsResult(null)
    setDistributionResult(null)
    setRankingResult(null)
    setStatsError(null)

    if (!supportsAnalytics) return

    const hasClass = Boolean(grade.classId?.trim())
    const hasCourse = Boolean(grade.courseCode?.trim())
    if (!hasClass && !hasCourse) {
      setStatsError(t("grades.stats.noClassOrCourse"))
      return
    }

    const initialScope: "class" | "course" = hasClass ? "class" : "course"
    setStatsScope(initialScope)
    await fetchStatsForScope(grade, initialScope)
  }

  async function handleScopeChange(scope: "class" | "course"): Promise<void> {
    if (!selectedGrade || scope === statsScope) return
    setStatsScope(scope)
    await fetchStatsForScope(selectedGrade, scope)
  }

  const filtered = useMemo(() => {
    return displayGrades.filter((grade) => {
      if (term !== ALL_TERM && grade.semester !== term) return false
      if (courseType !== ALL_COURSE_TYPE && grade.courseType !== courseType) return false
      return true
    })
  }, [displayGrades, term, courseType])

  const sorted = useMemo(() => {
    if (sortMode === "default") return filtered
    return [...filtered].sort((left, right) => {
      const scoreLeft = numericValue(left.numericScore, left.score)
      const scoreRight = numericValue(right.numericScore, right.score)
      const validLeft = scoreLeft !== undefined
      const validRight = scoreRight !== undefined
      if (!validLeft && !validRight) return 0
      if (!validLeft) return 1
      if (!validRight) return -1
      return sortMode === "asc" ? scoreLeft - scoreRight : scoreRight - scoreLeft
    })
  }, [filtered, sortMode])

  const termWeightedGpa = useMemo(() => {
    if (term === ALL_TERM) return null
    let totalWeightedPoints = 0
    let totalCredits = 0
    for (const grade of filtered) {
      if (!grade.isMajor || (grade.isRetake && grade.isRetake !== "正考")) continue
      const gp = numericValue(grade.numericGradePoint, grade.gradePoint)
      const cr = numericValue(grade.numericCredit, grade.credit)
      if (gp !== undefined && cr !== undefined && cr > 0) {
        const weight = grade.isDegreeCourse ? 1.2 : 1
        totalWeightedPoints += gp * cr * weight
        totalCredits += cr * weight
      }
    }
    if (totalCredits === 0) return null
    return (totalWeightedPoints / totalCredits).toFixed(4)
  }, [filtered, term])

  const detailScorePercent = selectedGrade ? scorePercentOf(selectedGrade) : undefined

  if (loading && grades.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <Skeleton className="h-24" />
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const renderFilterControls = (idPrefix: string) => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel>{t("grades.termLabel")}</FieldLabel>
        <ResponsiveSelect
          nested
          value={term}
          onValueChange={setTerm}
          placeholder={t("grades.allTerms")}
          title={t("grades.termLabel")}
          items={[
            { value: ALL_TERM, label: t("grades.allTerms") },
            ...terms.map((item) => ({ value: item, label: item })),
          ]}
        />
      </Field>
      {courseTypes.length > 0 && (
        <Field className="w-40">
          <FieldLabel>{t("grades.courseTypeLabel")}</FieldLabel>
          <ResponsiveSelect
            nested
            value={courseType}
            onValueChange={setCourseType}
            placeholder={t("grades.allCourseTypes")}
            title={t("grades.courseTypeLabel")}
            items={[
              { value: ALL_COURSE_TYPE, label: t("grades.allCourseTypes") },
              ...courseTypes.map((item) => ({ value: item, label: item })),
            ]}
          />
        </Field>
      )}
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-course-name`}>{t("grades.courseNameLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-course-name`}
          value={courseName}
          onChange={(event) => setCourseName(event.target.value)}
          placeholder={t("grades.courseNamePlaceholder")}
        />
      </Field>
      <Field>
        <FieldLabel>{t("grades.sortLabel")}</FieldLabel>
        <ToggleGroup
          type="single"
          value={sortMode}
          onValueChange={(val) => {
            if (val === "default" || val === "asc" || val === "desc") {
              setSortMode(val)
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="default" aria-label={t("grades.sortDefault")}>
            <ArrowUpDown className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="asc" aria-label={t("grades.sortAsc")}>
            <ArrowUp className="size-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="desc" aria-label={t("grades.sortDesc")}>
            <ArrowDown className="size-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Button
        type="button"
        onClick={() => {
          void handleSearch()
          setFilterDrawerOpen(false)
        }}
        disabled={loading}
      >
        {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        {t("grades.search")}
      </Button>
      {gachaEnabled && scoredGrades.length > 0 && (
        <Button type="button" variant="outline" onClick={handlePlayDraw}>
          <Dices data-icon="inline-start" />
          {t("gacha.play")}
        </Button>
      )}
    </FieldGroup>
  )

  return (
    <div data-page="grades" className="flex flex-col gap-6 md:gap-8">
      <GpaSummary
        gpa={gpaQuery.data}
        gpaScale={gpaScale}
        termWeightedGpa={termWeightedGpa}
        gpaVisible={gpaVisible}
        gpaDisplayMode={gpaDisplayMode}
        onSetGpaVisible={actions.setGpaVisible}
        t={t}
      />

      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>{t("grades.title")}</CardTitle>
          <CardDescription>{t("grades.description")}</CardDescription>
        </CardHeader>
        <CardContent>{renderFilterControls("grades-desktop")}</CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {sorted.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground md:col-span-2">
            {t("grades.table.noData")}
          </p>
        ) : (
          sorted.map((grade, index) => (
            <button
              key={`${gradeKey(grade)}-${index}`}
              type="button"
              data-grade-card={grade.courseName}
              onClick={() => void handleOpenGradeDetail(grade)}
              className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 active:bg-muted/70"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{grade.courseName}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {grade.semester && <span>{grade.semester}</span>}
                    {grade.courseType && (
                      <>
                        <span>·</span>
                        <span>{grade.courseType}</span>
                      </>
                    )}
                    {grade.credit && (
                      <>
                        <span>·</span>
                        <span>
                          {t("grades.table.credit")} {grade.credit}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-lg leading-none font-semibold tabular-nums">
                      {grade.score || "-"}
                    </span>
                    {grade.gradeLevel && (
                      <span className="text-xs font-medium text-muted-foreground">
                        {grade.gradeLevel}
                      </span>
                    )}
                  </div>
                  {grade.gradePoint && (
                    <span className="text-[10px] text-muted-foreground">GP {grade.gradePoint}</span>
                  )}
                  <div className="flex items-center gap-1">
                    {grade.isDegreeCourse && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("grades.degreeCourse")}
                      </Badge>
                    )}
                    {grade.isPass ? (
                      <Badge variant="default" className="text-[10px]">
                        {t("grades.table.pass")}
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        {t("grades.table.fail")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("grades.title")}
        description={t("grades.description")}
      >
        {renderFilterControls("grades-drawer")}
      </FilterDrawer>

      <ResponsiveModal open={detailOpen} onOpenChange={setDetailOpen}>
        <ResponsiveModalContent className="sm:max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>
              {selectedGrade?.courseName || t("grades.stats.title")}
            </ResponsiveModalTitle>
            {selectedGrade && (selectedGrade.courseType || selectedGrade.credit) && (
              <div
                data-grade-detail-badges=""
                className="flex flex-wrap items-center justify-center gap-1 pt-1"
              >
                {selectedGrade.courseType && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {selectedGrade.courseType}
                  </Badge>
                )}
                {selectedGrade.credit && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {t("grades.table.credit")} {selectedGrade.credit}
                  </Badge>
                )}
              </div>
            )}
            <ResponsiveModalDescription className="sr-only">
              {t("grades.stats.description")}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex flex-col gap-5 pb-4">
            {selectedGrade && (
              <section data-grade-detail="" className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-col gap-2">
                    <span className="text-xs text-muted-foreground">{t("grades.table.score")}</span>
                    <div className="flex items-baseline gap-2">
                      <span
                        data-grade-detail-score=""
                        className="text-4xl leading-none font-semibold tabular-nums"
                      >
                        {selectedGrade.score || selectedGrade.gradeLevel || "-"}
                      </span>
                      {selectedGrade.score && selectedGrade.gradeLevel && (
                        <span className="text-base font-medium text-muted-foreground">
                          {selectedGrade.gradeLevel}
                        </span>
                      )}
                    </div>
                    {detailScorePercent !== undefined && (
                      <div
                        aria-hidden="true"
                        className="mt-1 h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${detailScorePercent}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {selectedGrade.gradePoint && (
                      <div data-grade-detail-grade-point="" className="flex items-baseline gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {t("grades.table.gradePoint")}
                        </span>
                        <span className="text-lg leading-none font-semibold tabular-nums">
                          {selectedGrade.gradePoint}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-1">
                      {selectedGrade.isDegreeCourse && (
                        <Badge variant="outline" className="text-[10px]">
                          {t("grades.degreeCourse")}
                        </Badge>
                      )}
                      {selectedGrade.isPass ? (
                        <Badge variant="default" className="text-[10px]">
                          {t("grades.table.pass")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="text-[10px]">
                          {t("grades.table.fail")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {supportsAnalytics && selectedGrade && (
              <>
                <Separator />

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t("grades.stats.title")}</span>
                  <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={statsScope}
                    onValueChange={(val) => {
                      if (val === "class" || val === "course") {
                        void handleScopeChange(val)
                      }
                    }}
                    disabled={statsLoading}
                  >
                    <ToggleGroupItem value="class" disabled={!selectedGrade.classId?.trim()}>
                      {t("grades.stats.scopeClass")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="course" disabled={!selectedGrade.courseCode?.trim()}>
                      {t("grades.stats.scopeCourse")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                {statsError ? (
                  <p className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                    {statsError}
                  </p>
                ) : statsLoading ? (
                  <div className="flex flex-col gap-3">
                    <Skeleton className="h-20" />
                    <Skeleton className="h-32" />
                    <Skeleton className="h-20" />
                  </div>
                ) : (
                  <>
                    <section className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold">
                        {t("grades.stats.sectionStatistics")}
                      </h3>
                      {statsResult ? (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="flex flex-col gap-1 rounded-md border p-2.5">
                            <span className="text-[10px] text-muted-foreground">
                              {t("grades.stats.highest")}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                              {statsResult.highestScore?.toFixed(1) ?? "-"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 rounded-md border p-2.5">
                            <span className="text-[10px] text-muted-foreground">
                              {t("grades.stats.lowest")}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                              {statsResult.lowestScore?.toFixed(1) ?? "-"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 rounded-md border p-2.5">
                            <span className="text-[10px] text-muted-foreground">
                              {t("grades.stats.average")}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                              {statsResult.averageScore?.toFixed(1) ?? "-"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                      )}
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold">
                        {t("grades.stats.sectionDistribution")}
                      </h3>
                      {distributionResult && distributionResult.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                          {(() => {
                            const maxCount = Math.max(
                              ...distributionResult.map((entry) => entry.count || 0),
                              1
                            )
                            return distributionResult.map((entry, idx) => {
                              const pct = ((entry.count || 0) / maxCount) * 100
                              return (
                                <div key={idx} className="flex items-center gap-3 text-xs">
                                  <span className="w-16 shrink-0 truncate">
                                    {entry.levelName || entry.levelCode || "-"}
                                  </span>
                                  <div className="relative flex-1">
                                    <div className="h-5 w-full rounded-sm bg-muted">
                                      <div
                                        className="h-full rounded-sm bg-primary/70"
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                  </div>
                                  <span className="w-12 shrink-0 text-right text-muted-foreground tabular-nums">
                                    {t("grades.stats.count", { count: entry.count })}
                                  </span>
                                </div>
                              )
                            })
                          })()}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                      )}
                    </section>

                    <Separator />

                    <section className="flex flex-col gap-2">
                      <h3 className="text-sm font-semibold">{t("grades.stats.sectionRanking")}</h3>
                      {rankingResult ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="flex flex-col gap-1 rounded-md border p-2.5">
                            <span className="text-[10px] text-muted-foreground">
                              {t("grades.stats.myScore")}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                              {rankingResult.score?.toFixed(1) ?? "-"}
                            </span>
                          </div>
                          <div className="flex flex-col gap-1 rounded-md border p-2.5">
                            <span className="text-[10px] text-muted-foreground">
                              {t("grades.stats.rank")}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                              {t("grades.stats.rankFormat", {
                                rank: rankingResult.rank,
                                total: rankingResult.total,
                              })}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t("grades.stats.noData")}</p>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <GradeGachaModal
        open={gachaOpen}
        pending={gachaPending}
        gradeScale={gradeScale}
        onCommit={() => props.commitGachaPending(session.username)}
        onClose={() => setGachaOpen(false)}
        t={t}
      />
      <GradeGachaModal
        open={playItems !== null}
        pending={playItems ?? []}
        gradeScale={gradeScale}
        isPlay
        onClose={() => setPlayItems(null)}
        t={t}
      />
    </div>
  )
}
