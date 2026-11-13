"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ysu/plugin-ui/components"
import { Skeleton } from "@ysu/plugin-ui/components"
import { Badge } from "@ysu/plugin-ui/components"
import { Button } from "@ysu/plugin-ui/components"
import { Input } from "@ysu/plugin-ui/components"
import { Spinner } from "@ysu/plugin-ui/components"
import { Field, FieldGroup, FieldLabel } from "@ysu/plugin-ui/components"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@ysu/plugin-ui/components"
import { FilterDrawer, FilterTrigger } from "@ysu/plugin-ui/components"
import { useSettingsStore } from "@ysu/plugin-ui/stores"
import { useMobileHeaderRight } from "@ysu/plugin-ui/stores"
import { useTranslation } from "@ysu/plugin-ui/hooks"
import { compareExamStartTime, formatExamTime, isExamCompleted } from "@ysu/plugin-ui/academic"
import { syncExamsToWidget } from "@ysu/plugin-ui/platform"
import { useExams } from "@ysu/plugin-ui/hooks"
import { CalendarOff, CheckCircle2, Clock, MapPin, Search } from "lucide-react"

export function ExamsPage() {
  const { t } = useTranslation()
  const [term, setTerm] = useState("")
  const [queriedTerm, setQueriedTerm] = useState("")
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours)
  const examsQuery = useExams({ semester: queriedTerm || undefined })
  const exams = examsQuery.data ?? []
  const loading = examsQuery.isLoading || examsQuery.isValidating

  useEffect(() => {
    if (queriedTerm || !examsQuery.data) return
    syncExamsToWidget(examsQuery.data, widgetSyncReminderHours).catch(() => {})
  }, [queriedTerm, examsQuery.data, widgetSyncReminderHours])

  useEffect(() => {
    if (!examsQuery.error) return
    toast.error(examsQuery.error.message || t("app.updating"))
  }, [examsQuery.error, t])

  async function handleQuery() {
    const nextTerm = term.trim()
    setFilterDrawerOpen(false)
    if (nextTerm === queriedTerm) {
      await examsQuery.mutate()
      return
    }
    setQueriedTerm(nextTerm)
  }

  useMobileHeaderRight(
    <FilterTrigger
      label={queriedTerm || t("exams.termLabel")}
      onClick={() => setFilterDrawerOpen(true)}
    />,
    [queriedTerm, t]
  )

  const renderFilterControls = (idPrefix: string) => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-term`}>{t("exams.termLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-term`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={t("exams.termPlaceholder")}
        />
      </Field>
      <Button onClick={handleQuery} disabled={loading}>
        {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        {t("exams.query")}
      </Button>
    </FieldGroup>
  )

  const upcomingExams = exams.filter((e) => !isExamCompleted(e)).sort(compareExamStartTime)
  const completedExams = exams.filter((e) => isExamCompleted(e)).sort(compareExamStartTime)

  if (loading && exams.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="hidden md:block">
        <CardHeader>
          <CardTitle>{t("exams.title")}</CardTitle>
          <CardDescription>{t("exams.description")}</CardDescription>
        </CardHeader>
        <CardContent>{renderFilterControls("exams-desktop")}</CardContent>
      </Card>

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("exams.title")}
        description={t("exams.description")}
      >
        {renderFilterControls("exams-drawer")}
      </FilterDrawer>

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
              {upcomingExams.map((exam) => (
                <Card key={`${exam.name}-${exam.startAt ?? ""}-${exam.examLocation ?? ""}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-base">{exam.name}</CardTitle>
                      <Badge variant="default">{t("exams.upcomingExams")}</Badge>
                    </div>
                    <CardDescription>{exam.examName}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <span>{formatExamTime(exam)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin className="size-4 text-muted-foreground" />
                      <span>{exam.examLocation}</span>
                    </div>
                    {exam.seatNumber && (
                      <Badge variant="outline">
                        {t("exams.seatNumber")}: {exam.seatNumber}
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              ))}
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
                    className="opacity-60"
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-base">{exam.name}</CardTitle>
                        <Badge variant="secondary" className="gap-1">
                          <CheckCircle2 className="size-3" />
                          {t("exams.completed")}
                        </Badge>
                      </div>
                      <CardDescription>{exam.examName}</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-muted-foreground" />
                        <span>{formatExamTime(exam)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin className="size-4 text-muted-foreground" />
                        <span>{exam.examLocation}</span>
                      </div>
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
