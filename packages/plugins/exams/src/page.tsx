import { useEffect, useState } from "react"
import { CalendarOff, CheckCircle2, Clock, MapPin, Search } from "lucide-react"
import { toast } from "sonner"
import { compareExamStartTime, formatExamTime, isExamCompleted } from "@orahako/academic-kit"
import type { Exam, ProviderRuntimeSnapshot, QuerySnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Field,
  FieldGroup,
  FieldLabel,
  FilterDrawer,
  Input,
  Skeleton,
  Spinner,
} from "@orahako/ui-primitives"
import type { ExamsDictionary } from "./dictionary"
import type { ExamsViewStoreInstance } from "./store"
import { computeExamDayDiff } from "./widget-sync"

export interface ExamsPageInject {
  readonly hooks: {
    readonly exams: ObservableSource<QuerySnapshot<Exam[]>>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly queriedTerm: ObservableSource<string>
  }
  readonly queryBySemester: (semester: string) => Promise<void>
}

export type ExamsPageProps = DerivedComponentProps<
  Record<string, never>,
  ExamsDictionary,
  undefined,
  ExamsViewStoreInstance,
  ExamsPageInject
>

export const ExamsPage: SlotComponent<ExamsPageProps> = (props) => {
  const { t, actions, useStore } = props
  const examsQuery = props.useExams()
  const providerSnap = props.useProvider()
  const queriedTerm = props.useQueriedTerm()
  const timeZone = providerSnap.provider?.timeZone

  const [term, setTerm] = useState(queriedTerm)
  useEffect(() => {
    setTerm(queriedTerm)
  }, [queriedTerm])
  const filterDrawerOpen = useStore((state) => state.filterDrawerOpen)
  const { setFilterDrawerOpen } = actions

  useEffect(() => {
    return () => setFilterDrawerOpen(false)
  }, [setFilterDrawerOpen])
  const exams = examsQuery.data ?? []
  const loading = examsQuery.isLoading || examsQuery.isRefreshing
  const now = new Date()

  useEffect(() => {
    if (!examsQuery.error) return
    toast.error(examsQuery.error.message || t("updating"))
  }, [examsQuery.error, t])

  async function handleQuery(): Promise<void> {
    const nextTerm = term.trim()
    setFilterDrawerOpen(false)
    await props.queryBySemester(nextTerm)
  }

  const renderFilterControls = (idPrefix: string) => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-term`}>{t("exams.termLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-term`}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t("exams.termPlaceholder")}
        />
      </Field>
      <Button type="button" onClick={() => void handleQuery()} disabled={loading}>
        {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        {t("exams.query")}
      </Button>
    </FieldGroup>
  )

  const filterDrawer = (
    <FilterDrawer
      open={filterDrawerOpen}
      onOpenChange={setFilterDrawerOpen}
      title={t("exams.title")}
      description={t("exams.description")}
    >
      {renderFilterControls("exams-drawer")}
    </FilterDrawer>
  )

  const upcomingExams = exams
    .filter((exam) => !isExamCompleted(exam, now, timeZone))
    .sort((a, b) => compareExamStartTime(a, b, timeZone))
  const completedExams = exams
    .filter((exam) => isExamCompleted(exam, now, timeZone))
    .sort((a, b) => compareExamStartTime(a, b, timeZone))

  if (loading && exams.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="hidden h-12 md:block" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton key={idx} className="h-32" />
          ))}
        </div>
        {filterDrawer}
      </div>
    )
  }

  return (
    <div data-page="exams" className="flex flex-col gap-6">
      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>{t("exams.title")}</CardTitle>
          <CardDescription>{t("exams.description")}</CardDescription>
        </CardHeader>
        <CardContent>{renderFilterControls("exams-desktop")}</CardContent>
      </Card>

      {filterDrawer}

      {exams.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOff />
            </EmptyMedia>
            <EmptyTitle>{t("exams.noData")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {upcomingExams.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              {upcomingExams.map((exam) => {
                const dayDiff = computeExamDayDiff(exam, now, timeZone)
                const countdownText =
                  dayDiff === null || dayDiff < 0
                    ? t("exams.upcomingExams")
                    : dayDiff === 0
                      ? t("exams.examToday")
                      : dayDiff === 1
                        ? t("exams.examTomorrow")
                        : t("exams.examInDays", { count: dayDiff })

                return (
                  <Card
                    key={`${exam.name}-${exam.startAt ?? ""}-${exam.examLocation ?? ""}`}
                    data-exam-card="upcoming"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{exam.name}</CardTitle>
                        <Badge
                          variant={dayDiff !== null && dayDiff <= 1 ? "default" : "secondary"}
                          data-exam-countdown=""
                        >
                          {countdownText}
                        </Badge>
                      </div>
                      {exam.examName && <CardDescription>{exam.examName}</CardDescription>}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{formatExamTime(exam)}</span>
                      </div>
                      {exam.examLocation && (
                        <div className="flex items-center gap-2">
                          <MapPin className="size-4 text-muted-foreground" />
                          <span>{exam.examLocation}</span>
                        </div>
                      )}
                      {exam.seatNumber && (
                        <Badge variant="outline">
                          {t("exams.seatNumber")}: {exam.seatNumber}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

          {completedExams.length > 0 && (
            <>
              <h3 className="text-sm font-medium text-muted-foreground">
                {t("exams.completedExams")}
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {completedExams.map((exam) => (
                  <Card
                    key={`${exam.name}-${exam.startAt ?? ""}-${exam.examLocation ?? ""}`}
                    data-exam-card="completed"
                    className="opacity-60"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{exam.name}</CardTitle>
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="size-3" />
                          {t("exams.completed")}
                        </Badge>
                      </div>
                      {exam.examName && <CardDescription>{exam.examName}</CardDescription>}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{formatExamTime(exam)}</span>
                      </div>
                      {exam.examLocation && (
                        <div className="flex items-center gap-2">
                          <MapPin className="size-4 text-muted-foreground" />
                          <span>{exam.examLocation}</span>
                        </div>
                      )}
                      {exam.seatNumber && (
                        <Badge variant="outline">
                          {t("exams.seatNumber")}: {exam.seatNumber}
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
