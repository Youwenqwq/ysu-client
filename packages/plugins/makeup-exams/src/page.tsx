import { useEffect, useMemo, useState } from "react"
import { Clock, FilePenLine, School } from "lucide-react"
import { toast } from "sonner"
import { formatTimeRange } from "@orahako/academic-kit"
import type {
  MakeupExamBatch,
  MakeupExamCourse,
  MakeupExamSignupInput,
  QuerySnapshot,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FilterChips,
  LoadingCards,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  useErrorToast,
  ValidatingList,
} from "@orahako/ui-primitives"
import type { MakeupExamsDictionary } from "./dictionary"
import type { MakeupCourseFilter } from "./query-source"

export interface MakeupExamsPageInject {
  readonly hooks: {
    readonly batches: ObservableSource<QuerySnapshot<MakeupExamBatch[]>>
    readonly courses: ObservableSource<QuerySnapshot<MakeupExamCourse[]>>
  }
  readonly selectCourseFilter: (filter: MakeupCourseFilter) => void
  readonly signupMakeupExam: (input: MakeupExamSignupInput) => Promise<void>
}

export type MakeupExamsPageProps = DerivedComponentProps<
  Record<string, never>,
  MakeupExamsDictionary,
  undefined,
  undefined,
  MakeupExamsPageInject
>

export const MakeupExamsPage: SlotComponent<MakeupExamsPageProps> = (props) => {
  const { t } = props
  const batchesQuery = props.useBatches()
  const coursesQuery = props.useCourses()

  const [selectedBatchId, setSelectedBatchId] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<"available" | "registered">("available")
  const [signupTarget, setSignupTarget] = useState<MakeupExamCourse | null>(null)
  const [signingUp, setSigningUp] = useState(false)

  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data])
  const effectiveBatchId = selectedBatchId ?? batches[0]?.batchId

  useEffect(() => {
    if (!selectedBatchId && batches.length > 0) {
      setSelectedBatchId(batches[0]!.batchId)
    }
  }, [batches, selectedBatchId])

  const { selectCourseFilter } = props
  useEffect(() => {
    selectCourseFilter({
      batchId: effectiveBatchId,
      registered: tab === "registered",
    })
  }, [effectiveBatchId, tab, selectCourseFilter])

  const courses = coursesQuery.data ?? []

  useErrorToast(batchesQuery.error ?? undefined)
  useErrorToast(coursesQuery.error ?? undefined)

  async function handleSignupConfirm(): Promise<void> {
    const targetBatchId = signupTarget?.batchId ?? effectiveBatchId
    if (!signupTarget?.taskId || !targetBatchId) return
    setSigningUp(true)
    try {
      await props.signupMakeupExam({
        taskId: signupTarget.taskId,
        batchId: targetBatchId,
      })
      toast.success(t("makeupExams.signupSuccess"))
      setSignupTarget(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      toast.error(message || t("updating"))
    } finally {
      setSigningUp(false)
    }
  }

  const selectedBatch = batches.find((batch) => batch.batchId === effectiveBatchId)
  const loading =
    batchesQuery.isLoading ||
    batchesQuery.isRefreshing ||
    (coursesQuery.isLoading && courses.length === 0)

  if (batchesQuery.isLoading && batches.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-10" />
        <LoadingCards className="h-28" />
      </div>
    )
  }

  return (
    <div data-page="makeup-exams" className="flex flex-col gap-6">
      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("makeupExams.noBatch")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <FilterChips
            items={batches.map((batch) => ({ value: batch.batchId, label: batch.name }))}
            value={effectiveBatchId}
            onChange={setSelectedBatchId}
          />
          {selectedBatch && (
            <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              {(selectedBatch.signupStart || selectedBatch.signupEnd) && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 shrink-0" />
                  <span>
                    {t("makeupExams.signupWindow")}:{" "}
                    {formatTimeRange(selectedBatch.signupStart, selectedBatch.signupEnd)}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <Badge variant="outline">
                  {t("makeupExams.availableCount", {
                    count: selectedBatch.availableCount,
                  })}
                </Badge>
                <Badge variant="outline">
                  {t("makeupExams.registeredCount", {
                    count: selectedBatch.registeredCount,
                  })}
                </Badge>
              </div>
            </div>
          )}
        </div>
      )}

      {batches.length > 0 && (
        <Tabs
          value={tab}
          onValueChange={(val) => {
            if (val === "available" || val === "registered") {
              setTab(val)
            }
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="available">{t("makeupExams.availableTab")}</TabsTrigger>
            <TabsTrigger value="registered">{t("makeupExams.registeredTab")}</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {batches.length > 0 &&
        (loading && courses.length === 0 ? (
          <LoadingCards className="h-28" />
        ) : courses.length === 0 ? (
          <EmptyState
            title={
              tab === "available" ? t("makeupExams.noAvailable") : t("makeupExams.noRegistered")
            }
          />
        ) : (
          <ValidatingList validating={coursesQuery.isRefreshing} className="flex flex-col gap-4">
            {courses.map((course, idx) => (
              <Card
                key={`${course.taskId || course.code || course.name}-${idx}`}
                data-makeup-course={course.name}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{course.name}</CardTitle>
                    {course.status && (
                      <Badge variant={tab === "registered" ? "default" : "secondary"}>
                        {course.status}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>
                    {[course.code, course.examSeq].filter(Boolean).join(" · ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                    {course.credit && (
                      <span>
                        {t("makeupExams.credit")}: {course.credit}
                      </span>
                    )}
                    {course.hours && (
                      <span>
                        {t("makeupExams.hours")}: {course.hours}
                      </span>
                    )}
                  </div>
                  {course.department && (
                    <div className="flex items-center gap-2">
                      <School className="size-4 shrink-0 text-muted-foreground" />
                      <span>{course.department}</span>
                    </div>
                  )}
                  {(course.signupStart || course.signupEnd) && (
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 shrink-0 text-muted-foreground" />
                      <span>{formatTimeRange(course.signupStart, course.signupEnd)}</span>
                    </div>
                  )}
                  {course.note && (
                    <div className="flex items-center gap-2">
                      <FilePenLine className="size-4 shrink-0 text-muted-foreground" />
                      <span>{course.note}</span>
                    </div>
                  )}
                  {tab === "available" && course.taskId && (course.batchId || effectiveBatchId) && (
                    <Button
                      type="button"
                      size="sm"
                      data-makeup-signup-trigger={course.taskId}
                      className="mt-1 self-start"
                      onClick={() => setSignupTarget(course)}
                    >
                      {t("makeupExams.signup")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </ValidatingList>
        ))}

      <Dialog
        open={signupTarget !== null}
        onOpenChange={(open) => {
          if (!open && !signingUp) setSignupTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("makeupExams.signupTitle")}</DialogTitle>
            <DialogDescription>
              {t("makeupExams.signupDesc", { name: signupTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={signingUp}
              onClick={() => setSignupTarget(null)}
            >
              {t("makeupExams.cancel")}
            </Button>
            <Button
              type="button"
              data-makeup-signup-confirm=""
              onClick={() => void handleSignupConfirm()}
              disabled={signingUp}
            >
              {signingUp && <Spinner data-icon="inline-start" />}
              {t("makeupExams.signup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
