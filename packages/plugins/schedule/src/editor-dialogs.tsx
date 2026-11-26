import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowRight,
  Copy,
  MoveRight,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"
import {
  formatMinuteRange,
  scheduleDate,
  schedulePatchDependents,
  type CourseOverride,
  type ScheduleDrop,
  type ScheduleIssue,
  type ScheduleOccurrence,
  type SchedulePatch,
} from "@orahako/academic-kit"
import type { ClassPeriod } from "@orahako/academic-sdk"
import type { ScheduleDeliveryMode, Translator } from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ToggleGroup,
  ToggleGroupItem,
  useBackLayer,
} from "@orahako/ui-primitives"
import {
  formatScheduleEditorError,
  translatePatchIssue,
  translatePatchOperation,
  type ScheduleDictionary,
} from "./dictionary"
import type { CustomScheduleItem, SchedulePatchDraft } from "./stores"

interface ScheduleAdjustmentDialogProps {
  readonly drop: ScheduleDrop | null
  readonly courses: readonly ScheduleOccurrence[]
  readonly periods: readonly ClassPeriod[]
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onSave: (draft: SchedulePatchDraft) => void
}

export function ScheduleAdjustmentDialog({
  drop,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  t,
  onClose,
  onSave,
}: ScheduleAdjustmentDialogProps): ReactNode {
  const [snapshot, setSnapshot] = useState({
    drop,
    courses,
    periods,
    termStartDate,
    totalWeeks,
    open: drop !== null,
    formKey: 0,
  })

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
            t={t}
            onClose={onClose}
            onSave={onSave}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

export interface SchedulePatchFormController {
  readonly drop: ScheduleDrop
  readonly isDay: boolean
  readonly first: ScheduleOccurrence | undefined
  readonly targetDate: string
  readonly setTargetDate: (value: string) => void
  readonly section: string
  readonly setSection: (value: string) => void
  readonly startSection: number
  readonly endSection: number
  readonly classroom: string
  readonly setClassroom: (value: string) => void
  readonly deliveryMode: ScheduleDeliveryMode
  readonly setDeliveryMode: (value: ScheduleDeliveryMode) => void
  readonly note: string
  readonly setNote: (value: string) => void
  readonly clearing: boolean
  readonly setClearing: (value: boolean) => void
  readonly minDate: string
  readonly maxDate: string
  readonly maxSection: number
  readonly targetCourses: readonly ScheduleOccurrence[]
  readonly overlaps: readonly ScheduleOccurrence[]
  readonly validSections: boolean
  readonly movedSlot: boolean
  readonly samePlace: boolean
  readonly canSave: boolean
  readonly save: (mode: SchedulePatch["mode"]) => void
}

export function useSchedulePatchForm({
  drop,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  t,
  onSave,
}: {
  readonly drop: ScheduleDrop
  readonly courses: readonly ScheduleOccurrence[]
  readonly periods: readonly ClassPeriod[]
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly t: Translator<ScheduleDictionary>
  readonly onSave: (draft: SchedulePatchDraft) => void
}): SchedulePatchFormController {
  const { selection } = drop
  const isDay = selection.kind === "day"
  const first = selection.courses[0]
  const [targetDate, setTargetDate] = useState(drop.targetDate)
  const [section, setSection] = useState(String(drop.targetStartSection))
  const [classroom, setClassroom] = useState(first?.classroom ?? "")
  const [deliveryMode, setDeliveryMode] = useState<ScheduleDeliveryMode>(
    first?.deliveryMode ?? "in_person"
  )
  const [note, setNote] = useState(isDay ? "" : (first?.note ?? ""))
  const [clearing, setClearing] = useState(false)
  useBackLayer(() => setClearing(false), clearing)

  const startSection = Number(section)
  const duration = first ? first.endSection - first.startSection : 0
  const endSection = startSection + duration
  const maxSection = periods.at(-1)?.section ?? 12
  const minDate = termStartDate ? scheduleDate(termStartDate, 1, 1) : ""
  const maxDate = termStartDate ? scheduleDate(termStartDate, totalWeeks, 7) : ""
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
  const movedSlot =
    selection.date !== targetDate || (!isDay && first?.startSection !== startSection)
  const detailsChanged =
    !isDay &&
    (classroom.trim() !== (first?.classroom ?? "").trim() ||
      deliveryMode !== (first?.deliveryMode ?? "in_person") ||
      note.trim() !== (first?.note ?? "").trim())
  const samePlace = !movedSlot && !detailsChanged
  const canSave =
    selection.courses.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(targetDate) &&
    (!minDate || targetDate >= minDate) &&
    (!maxDate || targetDate <= maxDate) &&
    validSections &&
    !samePlace

  const save = (mode: SchedulePatch["mode"]): void => {
    const clear = mode === "clear"
    if (!clear && !canSave) return
    const replaced = isDay && !clear ? [...targetCourses] : []
    try {
      onSave({
        kind: selection.kind,
        mode,
        sourceDate: selection.date,
        targetDate: clear ? selection.date : targetDate,
        targetStartSection: isDay || clear ? undefined : startSection,
        classroom:
          isDay || classroom.trim() === (first?.classroom ?? "").trim()
            ? undefined
            : classroom.trim(),
        deliveryMode:
          isDay || clear || deliveryMode === (first?.deliveryMode ?? "in_person")
            ? undefined
            : deliveryMode,
        note: note.trim(),
        source: [...selection.courses],
        replaced,
        dependsOn: [
          ...new Set([...selection.courses, ...replaced].flatMap((course) => course.patchIds)),
        ],
      })
    } catch (error) {
      toast.error(formatScheduleEditorError(t, error))
    }
  }

  return {
    drop,
    isDay,
    first,
    targetDate,
    setTargetDate,
    section,
    setSection,
    startSection,
    endSection,
    classroom,
    setClassroom,
    deliveryMode,
    setDeliveryMode,
    note,
    setNote,
    clearing,
    setClearing,
    minDate,
    maxDate,
    maxSection,
    targetCourses,
    overlaps,
    validSections,
    movedSlot,
    samePlace,
    canSave,
    save,
  }
}

export function SchedulePatchFormBody({
  form,
  showSource = true,
  allowClear = true,
  t,
}: {
  readonly form: SchedulePatchFormController
  readonly showSource?: boolean
  readonly allowClear?: boolean
  readonly t: Translator<ScheduleDictionary>
}): ReactNode {
  const { selection } = form.drop
  return (
    <>
      {showSource && (
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("scheduleEditor.source")}</span>
          <strong>
            {selection.date}
            {!form.isDay && form.first
              ? ` · ${t("scheduleEditor.sectionRange", { start: form.first.startSection, end: form.first.endSection })}`
              : ""}
          </strong>
          <ul className="flex flex-col gap-1">
            {selection.courses.map((course) => (
              <li key={course.occurrenceId}>
                {course.name}
                {form.isDay
                  ? ` · ${t("scheduleEditor.sectionRange", { start: course.startSection, end: course.endSection })}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="schedule-target-date">{t("scheduleEditor.targetDate")}</FieldLabel>
          <Input
            id="schedule-target-date"
            type="date"
            value={form.targetDate}
            min={form.minDate || undefined}
            max={form.maxDate || undefined}
            onChange={(event) => form.setTargetDate(event.target.value)}
          />
        </Field>
        {!form.isDay && (
          <>
            <Field data-invalid={!form.validSections}>
              <FieldLabel htmlFor="schedule-target-section">
                {t("scheduleEditor.startSection")}
              </FieldLabel>
              <Input
                id="schedule-target-section"
                type="number"
                min={1}
                max={form.maxSection}
                value={form.section}
                aria-invalid={!form.validSections}
                onChange={(event) => form.setSection(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("scheduleEditor.sectionRange", {
                  start: form.startSection || 0,
                  end: form.endSection || 0,
                })}
              </p>
            </Field>
            <Field>
              <FieldLabel>{t("scheduleCustom.deliveryLabel")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={form.deliveryMode}
                onValueChange={(value) => {
                  if (value === "in_person" || value === "online") form.setDeliveryMode(value)
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="in_person">
                  {t("schedule.deliveryInPerson")}
                </ToggleGroupItem>
                <ToggleGroupItem value="online">{t("schedule.deliveryOnline")}</ToggleGroupItem>
              </ToggleGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="schedule-target-room">
                {t("scheduleCustom.locationLabel")}
              </FieldLabel>
              <Input
                id="schedule-target-room"
                value={form.classroom}
                placeholder={
                  form.deliveryMode === "online"
                    ? t("scheduleCustom.locationOnlinePlaceholder")
                    : t("scheduleCustom.locationPlaceholder")
                }
                onChange={(event) => form.setClassroom(event.target.value)}
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor="schedule-adjustment-note">{t("scheduleEditor.note")}</FieldLabel>
          <Input
            id="schedule-adjustment-note"
            value={form.note}
            maxLength={300}
            placeholder={t("scheduleEditor.notePlaceholder")}
            onChange={(event) => form.setNote(event.target.value)}
          />
        </Field>
      </FieldGroup>
      {form.isDay && form.targetCourses.length > 0 && !form.samePlace && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t("scheduleEditor.replacingTarget")}</AlertTitle>
          <AlertDescription>
            {form.targetCourses.map((course) => course.name).join("、")}
          </AlertDescription>
        </Alert>
      )}
      {form.overlaps.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle>{t("scheduleEditor.overlapWarning")}</AlertTitle>
          <AlertDescription>
            {form.overlaps.map((course) => course.name).join("、")} ·{" "}
            {t("scheduleEditor.overlapPreserved")}
          </AlertDescription>
        </Alert>
      )}
      {allowClear &&
        (form.clearing ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{t("scheduleEditor.clearConfirm")}</AlertTitle>
            <AlertDescription>
              <p>{t("scheduleEditor.clearExplanation")}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => form.setClearing(false)}
                >
                  {t("scheduleEditor.cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => form.save("clear")}
                >
                  {t("scheduleEditor.confirmClear")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={!selection.courses.length}
            onClick={() => form.setClearing(true)}
          >
            {t("scheduleEditor.clearInstead")}
          </Button>
        ))}
    </>
  )
}

export function SchedulePatchFormActions({
  form,
  t,
}: {
  readonly form: SchedulePatchFormController
  readonly t: Translator<ScheduleDictionary>
}): ReactNode {
  const showCopy = form.isDay || form.movedSlot
  return (
    <>
      {showCopy && (
        <Button
          type="button"
          variant="outline"
          disabled={!form.canSave}
          onClick={() => form.save("copy")}
        >
          <Copy data-icon="inline-start" />
          {t(form.isDay ? "scheduleEditor.copyDay" : "scheduleEditor.copyCourse")}
        </Button>
      )}
      <Button type="button" disabled={!form.canSave} onClick={() => form.save("move")}>
        {(form.isDay || form.movedSlot) && <MoveRight data-icon="inline-start" />}
        {form.isDay
          ? t("scheduleEditor.moveDay")
          : form.movedSlot
            ? t("scheduleEditor.moveCourse")
            : t("scheduleCustom.save")}
      </Button>
    </>
  )
}

function ScheduleAdjustmentContent({
  drop,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  t,
  onClose,
  onSave,
}: Omit<ScheduleAdjustmentDialogProps, "drop"> & { readonly drop: ScheduleDrop }): ReactNode {
  const form = useSchedulePatchForm({
    drop,
    courses,
    periods,
    termStartDate,
    totalWeeks,
    t,
    onSave,
  })

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>
          {t(form.isDay ? "scheduleEditor.adjustDay" : "scheduleEditor.adjustCourse")}
        </ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {t("scheduleEditor.confirmDescription")}
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <SchedulePatchFormBody form={form} t={t} />
      </ResponsiveModalBody>
      <ResponsiveModalFooter className="gap-2" drawerClassName="gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("scheduleEditor.cancel")}
        </Button>
        <SchedulePatchFormActions form={form} t={t} />
      </ResponsiveModalFooter>
    </>
  )
}

export type ScheduleAdjustmentsDialogView =
  | null
  | { readonly kind: "manager"; readonly selectedPatchId: string | null }
  | { readonly kind: "confirmation"; readonly patch: SchedulePatch; readonly remove: boolean }

export function ScheduleAdjustmentsDialog({
  view,
  patches,
  issues,
  overrides = [],
  customItems = [],
  t,
  onClose,
  onConfirm,
  onRemove,
  onToggle,
  onJump,
  onShowOriginal,
  onEditOverride,
  onRestoreOverride,
  onEditCustomItem,
  onDeleteCustomItem,
}: {
  readonly view: ScheduleAdjustmentsDialogView
  readonly patches: readonly SchedulePatch[]
  readonly issues: readonly ScheduleIssue[]
  readonly overrides?: readonly CourseOverride[]
  readonly customItems?: readonly CustomScheduleItem[]
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onConfirm: () => void
  readonly onRemove: (id: string) => void
  readonly onToggle: (id: string, enabled: boolean) => void
  readonly onJump: (date: string) => void
  readonly onShowOriginal: () => void
  readonly onEditOverride?: (override: CourseOverride) => void
  readonly onRestoreOverride?: (courseKey: string, name: string) => void
  readonly onEditCustomItem?: (item: CustomScheduleItem) => void
  readonly onDeleteCustomItem?: (id: string, title: string) => void
}): ReactNode {
  const [snapshot, setSnapshot] = useState({ view, patches, issues, overrides, customItems })

  if (
    view !== null &&
    (snapshot.view !== view ||
      snapshot.patches !== patches ||
      snapshot.issues !== issues ||
      snapshot.overrides !== overrides ||
      snapshot.customItems !== customItems)
  ) {
    setSnapshot({ view, patches, issues, overrides, customItems })
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
            overrides={snapshot.overrides}
            customItems={snapshot.customItems}
            selectedPatchId={snapshot.view.selectedPatchId}
            t={t}
            onClose={onClose}
            onRemove={onRemove}
            onToggle={onToggle}
            onJump={onJump}
            onShowOriginal={onShowOriginal}
            onEditOverride={onEditOverride}
            onRestoreOverride={onRestoreOverride}
            onEditCustomItem={onEditCustomItem}
            onDeleteCustomItem={onDeleteCustomItem}
          />
        )}
        {snapshot.view?.kind === "confirmation" && (
          <ScheduleAdjustmentsConfirmationContent
            patch={snapshot.view.patch}
            patches={snapshot.patches}
            remove={snapshot.view.remove}
            t={t}
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
  overrides,
  customItems,
  selectedPatchId,
  t,
  onClose,
  onRemove,
  onToggle,
  onJump,
  onShowOriginal,
  onEditOverride,
  onRestoreOverride,
  onEditCustomItem,
  onDeleteCustomItem,
}: {
  readonly patches: readonly SchedulePatch[]
  readonly issues: readonly ScheduleIssue[]
  readonly overrides: readonly CourseOverride[]
  readonly customItems: readonly CustomScheduleItem[]
  readonly selectedPatchId: string | null
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onRemove: (id: string) => void
  readonly onToggle: (id: string, enabled: boolean) => void
  readonly onJump: (date: string) => void
  readonly onShowOriginal: () => void
  readonly onEditOverride?: (override: CourseOverride) => void
  readonly onRestoreOverride?: (courseKey: string, name: string) => void
  readonly onEditCustomItem?: (item: CustomScheduleItem) => void
  readonly onDeleteCustomItem?: (id: string, title: string) => void
}): ReactNode {
  const ordered = useMemo(
    () =>
      [...patches].sort((a, b) => {
        if (a.id === selectedPatchId) return -1
        if (b.id === selectedPatchId) return 1
        return b.createdAt.localeCompare(a.createdAt)
      }),
    [patches, selectedPatchId]
  )
  const hiddenOverrides = useMemo(
    () => overrides.filter((item) => item.hidden === true),
    [overrides]
  )
  const modifiedOverrides = useMemo(() => overrides.filter((item) => !item.hidden), [overrides])
  const hasAny = patches.length > 0 || overrides.length > 0 || customItems.length > 0

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>{t("scheduleEditor.manage")}</ResponsiveModalTitle>
        <ResponsiveModalDescription>
          {t("scheduleEditor.managementDescription")}
        </ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <Button type="button" variant="outline" onClick={onShowOriginal}>
          {t("scheduleEditor.showOriginal")}
        </Button>
        {!hasAny && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("scheduleCustom.noCustomizations")}
          </p>
        )}

        {hiddenOverrides.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {t("scheduleCustom.sectionHidden")}
            </h4>
            {hiddenOverrides.map((item) => (
              <section
                key={item.courseKey}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 p-3"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm">{item.originalName}</strong>
                    <Badge variant="secondary">{t("scheduleCustom.hiddenBadge")}</Badge>
                  </div>
                </div>
                {onRestoreOverride && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onRestoreOverride(item.courseKey, item.originalName)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    {t("scheduleCustom.unhideCourse")}
                  </Button>
                )}
              </section>
            ))}
          </div>
        )}

        {modifiedOverrides.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {t("scheduleCustom.sectionModified")}
            </h4>
            {modifiedOverrides.map((item) => (
              <section
                key={item.courseKey}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{item.name ?? item.originalName}</strong>
                  <Badge variant="secondary">{t("scheduleCustom.modifiedBadge")}</Badge>
                  {item.deliveryMode === "online" && (
                    <Badge variant="outline">{t("schedule.deliveryOnline")}</Badge>
                  )}
                </div>
                {(item.classroom || item.note) && (
                  <p className="text-xs text-muted-foreground">
                    {[item.classroom, item.note].filter(Boolean).join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {onEditOverride && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onClose()
                        onEditOverride(item)
                      }}
                    >
                      <Pencil data-icon="inline-start" />
                      {t("scheduleCustom.edit")}
                    </Button>
                  )}
                  {onRestoreOverride && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRestoreOverride(item.courseKey, item.originalName)}
                    >
                      <RotateCcw data-icon="inline-start" />
                      {t("scheduleCustom.restoreCourse")}
                    </Button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {customItems.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {t("scheduleCustom.sectionCustom")}
            </h4>
            {customItems.map((item) => (
              <section
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border/60 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-sm">{item.title}</strong>
                  <Badge variant="outline">
                    {t(
                      item.kind === "course"
                        ? "scheduleCustom.kindCourse"
                        : "scheduleCustom.kindEvent"
                    )}
                  </Badge>
                  {item.deliveryMode === "online" && (
                    <Badge variant="secondary">{t("schedule.deliveryOnline")}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[
                    item.recurrence === "once" && item.date ? item.date : undefined,
                    item.timeMode === "time" &&
                    typeof item.startMinute === "number" &&
                    typeof item.endMinute === "number"
                      ? formatMinuteRange(item.startMinute, item.endMinute)
                      : item.startSection
                        ? t("scheduleEditor.sectionRange", {
                            start: item.startSection,
                            end: item.endSection ?? item.startSection,
                          })
                        : undefined,
                    item.location,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {item.note && <p className="text-xs text-muted-foreground">{item.note}</p>}
                <div className="flex flex-wrap gap-2">
                  {onEditCustomItem && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onClose()
                        onEditCustomItem(item)
                      }}
                    >
                      <Pencil data-icon="inline-start" />
                      {t("scheduleCustom.edit")}
                    </Button>
                  )}
                  {onDeleteCustomItem && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDeleteCustomItem(item.id, item.title)}
                    >
                      <Trash2 data-icon="inline-start" />
                      {t("scheduleCustom.delete")}
                    </Button>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {ordered.length > 0 && (
          <div className="flex flex-col gap-3">
            <h4 className="text-xs font-semibold text-muted-foreground">
              {t("scheduleCustom.sectionPatches")}
            </h4>
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
                    <Badge variant="outline">{translatePatchOperation(t, patch.mode)}</Badge>
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
                            ? ` · ${t("scheduleEditor.sectionRange", {
                                start: patch.targetStartSection,
                                end:
                                  patch.targetStartSection +
                                  (patch.source[0]?.endSection ?? 0) -
                                  (patch.source[0]?.startSection ?? 0),
                              })}`
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
                          <p key={issue.reason}>{translatePatchIssue(t, issue.reason)}</p>
                        ))}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        try {
                          onToggle(patch.id, !patch.enabled)
                        } catch (error) {
                          toast.error(formatScheduleEditorError(t, error))
                        }
                      }}
                    >
                      {t(patch.enabled ? "scheduleEditor.disable" : "scheduleEditor.enable")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemove(patch.id)}
                    >
                      <Undo2 data-icon="inline-start" />
                      {t("scheduleEditor.remove")}
                    </Button>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </ResponsiveModalBody>
      <ResponsiveModalFooter>
        <Button type="button" onClick={onClose}>
          {t("scheduleEditor.close")}
        </Button>
      </ResponsiveModalFooter>
    </>
  )
}

function ScheduleAdjustmentsConfirmationContent({
  patch,
  patches,
  remove,
  t,
  onClose,
  onConfirm,
}: {
  readonly patch: SchedulePatch
  readonly patches: readonly SchedulePatch[]
  readonly remove: boolean
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onConfirm: () => void
}): ReactNode {
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
                <Badge variant="outline">{translatePatchOperation(t, item.mode)}</Badge>
              </div>
              <p className="text-muted-foreground">
                {item.sourceDate}
                {item.kind === "course" && item.source[0]
                  ? ` · ${t("scheduleEditor.sectionRange", { start: item.source[0].startSection, end: item.source[0].endSection })}`
                  : ""}
                {item.mode !== "clear" ? ` → ${item.targetDate}` : ""}
                {item.targetStartSection
                  ? ` · ${t("scheduleEditor.sectionRange", {
                      start: item.targetStartSection,
                      end:
                        item.targetStartSection +
                        (item.source[0]?.endSection ?? 0) -
                        (item.source[0]?.startSection ?? 0),
                    })}`
                  : ""}
              </p>
              {item.note && <p className="text-muted-foreground">{item.note}</p>}
            </li>
          ))}
        </ul>
      </ResponsiveModalBody>
      <ResponsiveModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("scheduleEditor.cancel")}
        </Button>
        <Button type="button" variant={remove ? "destructive" : "default"} onClick={onConfirm}>
          {t(remove ? "scheduleEditor.confirmUndo" : "scheduleEditor.confirmDisable")}
        </Button>
      </ResponsiveModalFooter>
    </>
  )
}
