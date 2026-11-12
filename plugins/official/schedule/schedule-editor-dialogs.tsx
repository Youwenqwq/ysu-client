"use client"

import { useMemo, useState } from "react"
import { ArrowRight, Copy, MoveRight, TriangleAlert, Undo2 } from "lucide-react"
import { toast } from "sonner"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useBackLayer } from "@/hooks/use-back-handler"
import { cn } from "@/lib/utils"
import {
  scheduleDate,
  schedulePatchDependents,
  type ScheduleDrop,
  type ScheduleIssue,
  type ScheduleOccurrence,
  type SchedulePatch,
} from "@/lib/academic/schedule-patches"
import type { ClassPeriod } from "@/providers/types"

type PatchDraft = Omit<SchedulePatch, "id" | "createdAt" | "enabled">

interface AdjustmentProps {
  drop: ScheduleDrop | null
  courses: ScheduleOccurrence[]
  periods: ClassPeriod[]
  termStartDate: string
  totalWeeks: number
  onClose: () => void
  onSave: (draft: PatchDraft) => void
}

export function ScheduleAdjustmentDialog({
  drop,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  onClose,
  onSave,
}: AdjustmentProps) {
  const [snapshot, setSnapshot] = useState({
    drop,
    courses,
    periods,
    termStartDate,
    totalWeeks,
    open: drop !== null,
    formKey: 0,
  })

  // Keep the last open content intact while Radix/Vaul owns the exit lifecycle.
  // Only a new opening/drop resets the form, including reopening during an exit.
  if (drop === null) {
    if (snapshot.open) setSnapshot({ ...snapshot, open: false })
  } else if (
    !snapshot.open ||
    snapshot.drop !== drop ||
    snapshot.courses !== courses ||
    snapshot.periods !== periods ||
    snapshot.termStartDate !== termStartDate ||
    snapshot.totalWeeks !== totalWeeks
  ) {
    setSnapshot({
      drop,
      courses,
      periods,
      termStartDate,
      totalWeeks,
      open: true,
      formKey: snapshot.formKey + (!snapshot.open || snapshot.drop !== drop ? 1 : 0),
    })
  }

  return (
    <ResponsiveModal
      open={drop !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveModalContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        {snapshot.drop && (
          <ScheduleAdjustmentContent
            key={snapshot.formKey}
            drop={snapshot.drop}
            courses={snapshot.courses}
            periods={snapshot.periods}
            termStartDate={snapshot.termStartDate}
            totalWeeks={snapshot.totalWeeks}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function ScheduleAdjustmentContent({
  drop,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  onClose,
  onSave,
}: AdjustmentProps & { drop: ScheduleDrop }) {
  const { t } = useTranslation()
  const { selection } = drop
  const isDay = selection.kind === "day"
  const first = selection.courses[0]
  const [targetDate, setTargetDate] = useState(drop.targetDate)
  const [section, setSection] = useState(String(drop.targetStartSection))
  const [classroom, setClassroom] = useState(first?.classroom ?? "")
  const [note, setNote] = useState("")
  const [clearing, setClearing] = useState(false)
  useBackLayer(() => setClearing(false), clearing)
  const startSection = Number(section)
  const duration = first ? first.endSection - first.startSection : 0
  const endSection = startSection + duration
  const minDate = scheduleDate(termStartDate, 1, 1)
  const maxDate = scheduleDate(termStartDate, totalWeeks, 7)
  const targetCourses = courses.filter((course) => course.date === targetDate)
  const overlaps = isDay
    ? []
    : targetCourses.filter(
        (course) =>
          !selection.courses.some((source) => source.occurrenceId === course.occurrenceId) &&
          course.startSection <= endSection &&
          course.endSection >= startSection
      )
  const validSections =
    isDay ||
    (Number.isInteger(startSection) &&
      startSection > 0 &&
      Array.from({ length: duration + 1 }, (_, index) => startSection + index).every((value) =>
        periods.some((period) => period.section === value)
      ))
  const samePlace = selection.date === targetDate && (isDay || first?.startSection === startSection)
  const canSave =
    selection.courses.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
    targetDate >= minDate &&
    targetDate <= maxDate &&
    validSections &&
    !samePlace

  function save(mode: SchedulePatch["mode"]) {
    const clear = mode === "clear"
    if (!clear && !canSave) return
    const replaced = isDay && !clear ? targetCourses : []
    try {
      onSave({
        kind: selection.kind,
        mode,
        sourceDate: selection.date,
        targetDate: clear ? selection.date : targetDate,
        targetStartSection: isDay || clear ? undefined : startSection,
        classroom: isDay || classroom === (first?.classroom ?? "") ? undefined : classroom.trim(),
        note: note.trim(),
        source: selection.courses,
        replaced,
        dependsOn: [
          ...new Set([...selection.courses, ...replaced].flatMap((course) => course.patchIds)),
        ],
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message.startsWith("scheduleEditor.")
            ? t(error.message)
            : error.message
          : t("scheduleEditor.saveFailed")
      )
    }
  }

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>
          {t(isDay ? "scheduleEditor.adjustDay" : "scheduleEditor.adjustCourse")}
        </ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {t("scheduleEditor.confirmDescription")}
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("scheduleEditor.source")}</span>
          <strong>
            {selection.date}
            {!isDay && first
              ? ` · ${t("scheduleEditor.sectionRange", { start: first.startSection, end: first.endSection })}`
              : ""}
          </strong>
          <ul className="flex flex-col gap-1">
            {selection.courses.map((course) => (
              <li key={course.occurrenceId}>
                {course.name}
                {isDay
                  ? ` · ${t("scheduleEditor.sectionRange", { start: course.startSection, end: course.endSection })}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="schedule-target-date">{t("scheduleEditor.targetDate")}</FieldLabel>
            <Input
              id="schedule-target-date"
              type="date"
              value={targetDate}
              min={minDate}
              max={maxDate}
              onChange={(event) => setTargetDate(event.target.value)}
            />
          </Field>
          {!isDay && (
            <>
              <Field data-invalid={!validSections}>
                <FieldLabel htmlFor="schedule-target-section">
                  {t("scheduleEditor.startSection")}
                </FieldLabel>
                <Input
                  id="schedule-target-section"
                  type="number"
                  min={1}
                  max={periods.at(-1)?.section ?? 12}
                  value={section}
                  aria-invalid={!validSections}
                  onChange={(event) => setSection(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  {t("scheduleEditor.sectionRange", {
                    start: startSection || 0,
                    end: endSection || 0,
                  })}
                </p>
              </Field>
              <Field>
                <FieldLabel htmlFor="schedule-target-room">{t("schedule.classroom")}</FieldLabel>
                <Input
                  id="schedule-target-room"
                  value={classroom}
                  onChange={(event) => setClassroom(event.target.value)}
                />
              </Field>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="schedule-adjustment-note">{t("scheduleEditor.note")}</FieldLabel>
            <Input
              id="schedule-adjustment-note"
              value={note}
              maxLength={300}
              placeholder={t("scheduleEditor.notePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </FieldGroup>
        {isDay && targetCourses.length > 0 && !samePlace && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>{t("scheduleEditor.replacingTarget")}</AlertTitle>
            <AlertDescription>
              {targetCourses.map((course) => course.name).join("、")}
            </AlertDescription>
          </Alert>
        )}
        {overlaps.length > 0 && (
          <Alert>
            <TriangleAlert />
            <AlertTitle>{t("scheduleEditor.overlapWarning")}</AlertTitle>
            <AlertDescription>
              {overlaps.map((course) => course.name).join("、")} ·{" "}
              {t("scheduleEditor.overlapPreserved")}
            </AlertDescription>
          </Alert>
        )}
        {clearing ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{t("scheduleEditor.clearConfirm")}</AlertTitle>
            <AlertDescription>
              <p>{t("scheduleEditor.clearExplanation")}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setClearing(false)}>
                  {t("scheduleEditor.cancel")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => save("clear")}>
                  {t("scheduleEditor.confirmClear")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={!selection.courses.length}
            onClick={() => setClearing(true)}
          >
            {t("scheduleEditor.clearInstead")}
          </Button>
        )}
      </ResponsiveModalBody>
      <ResponsiveModalFooter className="gap-2" drawerClassName="gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("scheduleEditor.cancel")}
        </Button>
        <Button variant="outline" disabled={!canSave} onClick={() => save("copy")}>
          <Copy data-icon="inline-start" />
          {t(isDay ? "scheduleEditor.copyDay" : "scheduleEditor.copyCourse")}
        </Button>
        <Button disabled={!canSave} onClick={() => save("move")}>
          <MoveRight data-icon="inline-start" />
          {t(isDay ? "scheduleEditor.moveDay" : "scheduleEditor.moveCourse")}
        </Button>
      </ResponsiveModalFooter>
    </>
  )
}

interface ManagerProps {
  patches: SchedulePatch[]
  issues: ScheduleIssue[]
  selectedPatchId: string | null
  onClose: () => void
  onRemove: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onJump: (date: string) => void
  onShowOriginal: () => void
}

interface AdjustmentsProps extends Omit<ManagerProps, "selectedPatchId"> {
  view:
    | null
    | { kind: "manager"; selectedPatchId: string | null }
    | { kind: "confirmation"; patch: SchedulePatch; remove: boolean }
  onConfirm: () => void
}

export function ScheduleAdjustmentsDialog({
  view,
  patches,
  issues,
  onClose,
  onConfirm,
  onRemove,
  onToggle,
  onJump,
  onShowOriginal,
}: AdjustmentsProps) {
  const [snapshot, setSnapshot] = useState({ view, patches, issues })

  // Keep the last open content intact while Radix/Vaul owns the exit lifecycle.
  // Updating during render also captures background changes before a later close.
  if (
    view !== null &&
    (snapshot.view !== view || snapshot.patches !== patches || snapshot.issues !== issues)
  ) {
    setSnapshot({ view, patches, issues })
  }

  return (
    <ResponsiveModal
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveModalContent
        className={cn(
          "flex max-h-[90dvh] flex-col",
          snapshot.view?.kind === "confirmation" ? "sm:max-w-lg" : "sm:max-w-xl"
        )}
      >
        {snapshot.view?.kind === "manager" && (
          <ScheduleAdjustmentsManagerContent
            patches={snapshot.patches}
            issues={snapshot.issues}
            selectedPatchId={snapshot.view.selectedPatchId}
            onClose={onClose}
            onRemove={onRemove}
            onToggle={onToggle}
            onJump={onJump}
            onShowOriginal={onShowOriginal}
          />
        )}
        {snapshot.view?.kind === "confirmation" && (
          <ScheduleAdjustmentsConfirmationContent
            patch={snapshot.view.patch}
            patches={snapshot.patches}
            remove={snapshot.view.remove}
            onClose={onClose}
            onConfirm={onConfirm}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function ScheduleAdjustmentsManagerContent({
  patches,
  issues,
  selectedPatchId,
  onClose,
  onRemove,
  onToggle,
  onJump,
  onShowOriginal,
}: ManagerProps) {
  const { t } = useTranslation()
  const ordered = useMemo(
    () =>
      [...patches].sort((a, b) => {
        if (a.id === selectedPatchId) return -1
        if (b.id === selectedPatchId) return 1
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [patches, selectedPatchId]
  )

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>{t("scheduleEditor.manage")}</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {t("scheduleEditor.managementDescription")}
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <Button variant="outline" onClick={onShowOriginal}>
          {t("scheduleEditor.showOriginal")}
        </Button>
        {patches.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("scheduleEditor.noAdjustments")}
          </p>
        )}
        {ordered.map((patch) => {
          const patchIssues = issues.filter((issue) => issue.patchId === patch.id)
          return (
            <section key={patch.id} className="flex flex-col gap-3 border-b pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">
                  {patch.kind === "day"
                    ? t("scheduleEditor.adjustDay")
                    : patch.source.map((course) => course.name).join("、")}
                </strong>
                <Badge variant={patchIssues.length ? "destructive" : "secondary"}>
                  {t(
                    !patch.enabled
                      ? "scheduleEditor.disabled"
                      : patchIssues.length
                        ? "scheduleEditor.needsReview"
                        : "scheduleEditor.active"
                  )}
                </Badge>
                <Badge variant="outline">{t(`scheduleEditor.operation_${patch.mode}`)}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  className="underline underline-offset-4"
                  onClick={() => onJump(patch.sourceDate)}
                >
                  {patch.sourceDate}
                  {patch.kind === "course" && patch.source[0]
                    ? ` · ${t("scheduleEditor.sectionRange", { start: patch.source[0].startSection, end: patch.source[0].endSection })}`
                    : ""}
                </button>
                {patch.mode !== "clear" && (
                  <>
                    <ArrowRight className="size-4" />
                    <button
                      type="button"
                      className="underline underline-offset-4"
                      onClick={() => onJump(patch.targetDate)}
                    >
                      {patch.targetDate}
                      {patch.targetStartSection
                        ? ` · ${t("scheduleEditor.sectionRange", { start: patch.targetStartSection, end: patch.targetStartSection + (patch.source[0]?.endSection ?? 0) - (patch.source[0]?.startSection ?? 0) })}`
                        : ""}
                    </button>
                  </>
                )}
              </div>
              {patch.note && <p className="text-sm text-muted-foreground">{patch.note}</p>}
              {patch.replaced.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("scheduleEditor.replacedCourses")}
                  {patch.replaced.map((course) => course.name).join("、")}
                </p>
              )}
              {patchIssues.length > 0 && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>{t("scheduleEditor.needsReview")}</AlertTitle>
                  <AlertDescription>
                    {patchIssues.map((issue) => (
                      <p key={issue.reason}>{t(`scheduleEditor.issue_${issue.reason}`)}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    try {
                      onToggle(patch.id, !patch.enabled)
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message.startsWith("scheduleEditor.")
                            ? t(error.message)
                            : error.message
                          : t("scheduleEditor.saveFailed")
                      )
                    }
                  }}
                >
                  {t(patch.enabled ? "scheduleEditor.disable" : "scheduleEditor.enable")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(patch.id)}>
                  <Undo2 data-icon="inline-start" />
                  {t("scheduleEditor.remove")}
                </Button>
              </div>
            </section>
          )
        })}
      </ResponsiveModalBody>
      <ResponsiveModalFooter>
        <Button onClick={onClose}>{t("scheduleEditor.close")}</Button>
      </ResponsiveModalFooter>
    </>
  )
}

function ScheduleAdjustmentsConfirmationContent({
  patch,
  patches,
  remove,
  onClose,
  onConfirm,
}: {
  patch: SchedulePatch
  patches: SchedulePatch[]
  remove: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const affected = useMemo(() => {
    const currentPatch = patches.find((item) => item.id === patch.id) ?? patch
    const dependents = new Set(schedulePatchDependents(patches, patch.id))
    return [currentPatch, ...patches.filter((item) => dependents.has(item.id))]
  }, [patch, patches])

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>{t("scheduleEditor.undoConfirm")}</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {t("scheduleEditor.undoExplanation", { count: affected.length - 1 })}
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <p className="text-sm font-medium">
          {t(remove ? "scheduleEditor.undoAffected" : "scheduleEditor.disableAffected", {
            count: affected.length,
          })}
        </p>
        <ul className="flex flex-col gap-3">
          {affected.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 border-b pb-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <strong>
                  {item.kind === "day"
                    ? t("scheduleEditor.adjustDay")
                    : item.source.map((course) => course.name).join("、")}
                </strong>
                <Badge variant="outline">{t(`scheduleEditor.operation_${item.mode}`)}</Badge>
              </div>
              <p className="text-muted-foreground">
                {item.sourceDate}
                {item.kind === "course" && item.source[0]
                  ? ` · ${t("scheduleEditor.sectionRange", { start: item.source[0].startSection, end: item.source[0].endSection })}`
                  : ""}
                {item.mode !== "clear" ? ` → ${item.targetDate}` : ""}
                {item.targetStartSection
                  ? ` · ${t("scheduleEditor.sectionRange", { start: item.targetStartSection, end: item.targetStartSection + (item.source[0]?.endSection ?? 0) - (item.source[0]?.startSection ?? 0) })}`
                  : ""}
              </p>
              {item.note && <p className="text-muted-foreground">{item.note}</p>}
            </li>
          ))}
        </ul>
      </ResponsiveModalBody>
      <ResponsiveModalFooter>
        <Button variant="outline" onClick={onClose}>
          {t("scheduleEditor.cancel")}
        </Button>
        <Button variant={remove ? "destructive" : "default"} onClick={onConfirm}>
          {t(remove ? "scheduleEditor.confirmUndo" : "scheduleEditor.confirmDisable")}
        </Button>
      </ResponsiveModalFooter>
    </>
  )
}
