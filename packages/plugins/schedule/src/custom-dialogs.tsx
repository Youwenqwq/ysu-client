import { useMemo, useState, type ReactNode } from "react"
import { Calendar, Clock, Globe, MapPin, Pencil, RotateCcw, StickyNote, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  formatClockMinute,
  formatMinuteRange,
  formatWeekList,
  parseTimeToMinutes,
  parseWeeks,
  type CourseOverride,
  type ScheduleDrop,
  type ScheduleOccurrence,
} from "@orahako/academic-kit"
import type { ClassPeriod, Course } from "@orahako/academic-sdk"
import type { ScheduleDeliveryMode, ScheduleEntry, Translator } from "@orahako/sdk"
import {
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
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import type { ScheduleDictionary } from "./dictionary"
import {
  SchedulePatchFormActions,
  SchedulePatchFormBody,
  useSchedulePatchForm,
} from "./editor-dialogs"
import type {
  CustomScheduleItem,
  CustomScheduleKind,
  CustomScheduleRecurrence,
  SchedulePatchDraft,
} from "./stores"

export type ScheduleItemFormTarget =
  | null
  | {
      readonly mode: "create"
      readonly initialKind?: CustomScheduleKind
      readonly initialDay?: number
      readonly initialDate?: string
      readonly initialSection?: number
      readonly initialWeek?: number
    }
  | {
      readonly mode: "edit-custom"
      readonly item: CustomScheduleItem
    }
  | {
      readonly mode: "override-course"
      readonly courseKey: string
      readonly rawCourse: Course
      readonly existingOverride?: CourseOverride
      readonly occurrence?: ScheduleOccurrence
      readonly initialScope?: "whole" | "once"
    }

const EMPTY_OCCURRENCES: readonly ScheduleOccurrence[] = []
const EMPTY_DROP: ScheduleDrop = {
  selection: { kind: "course", date: "", courses: [] },
  targetDate: "",
  targetStartSection: 1,
}

function parseHHMM(value: string): number | null {
  return parseTimeToMinutes(value)
}

export function ScheduleItemFormDialog({
  target,
  courses = EMPTY_OCCURRENCES,
  periods,
  termStartDate = "",
  totalWeeks,
  hasAcademicScope,
  semesterScope,
  t,
  onClose,
  onSaveCustom,
  onDeleteCustom,
  onSaveOverride,
  onRestoreOverride,
  onSaveSinglePatch,
}: {
  readonly target: ScheduleItemFormTarget
  readonly courses?: readonly ScheduleOccurrence[]
  readonly periods: readonly ClassPeriod[]
  readonly termStartDate?: string
  readonly totalWeeks: number
  readonly hasAcademicScope: boolean
  readonly semesterScope: string | null
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onSaveCustom: (item: CustomScheduleItem) => void
  readonly onDeleteCustom?: (id: string, title: string) => void
  readonly onSaveOverride: (override: CourseOverride) => void
  readonly onRestoreOverride?: (courseKey: string, name: string) => void
  readonly onSaveSinglePatch?: (draft: SchedulePatchDraft) => void
}): ReactNode {
  const [snapshot, setSnapshot] = useState<{ target: ScheduleItemFormTarget; key: number }>({
    target,
    key: 0,
  })
  if (target !== null && snapshot.target !== target) {
    setSnapshot({ target, key: snapshot.key + 1 })
  }

  return (
    <ResponsiveModal
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveModalContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        {snapshot.target && (
          <ScheduleItemFormContent
            key={snapshot.key}
            target={snapshot.target}
            courses={courses}
            periods={periods}
            termStartDate={termStartDate}
            totalWeeks={Math.max(1, totalWeeks || 20)}
            hasAcademicScope={hasAcademicScope}
            semesterScope={semesterScope}
            t={t}
            onClose={onClose}
            onSaveCustom={onSaveCustom}
            onDeleteCustom={onDeleteCustom}
            onSaveOverride={onSaveOverride}
            onRestoreOverride={onRestoreOverride}
            onSaveSinglePatch={onSaveSinglePatch}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function ScheduleItemFormContent({
  target,
  courses,
  periods,
  termStartDate,
  totalWeeks,
  hasAcademicScope,
  semesterScope,
  t,
  onClose,
  onSaveCustom,
  onDeleteCustom,
  onSaveOverride,
  onRestoreOverride,
  onSaveSinglePatch,
}: {
  readonly target: NonNullable<ScheduleItemFormTarget>
  readonly courses: readonly ScheduleOccurrence[]
  readonly periods: readonly ClassPeriod[]
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly hasAcademicScope: boolean
  readonly semesterScope: string | null
  readonly t: Translator<ScheduleDictionary>
  readonly onClose: () => void
  readonly onSaveCustom: (item: CustomScheduleItem) => void
  readonly onDeleteCustom?: (id: string, title: string) => void
  readonly onSaveOverride: (override: CourseOverride) => void
  readonly onRestoreOverride?: (courseKey: string, name: string) => void
  readonly onSaveSinglePatch?: (draft: SchedulePatchDraft) => void
}): ReactNode {
  const maxSection = periods.at(-1)?.section ?? 12
  const isOverride = target.mode === "override-course"
  const isEditCustom = target.mode === "edit-custom"
  const singleOccurrence = isOverride ? target.occurrence : undefined
  const canEditSingle = Boolean(singleOccurrence && onSaveSinglePatch && termStartDate)
  const [editScope, setEditScope] = useState<"whole" | "once">(() =>
    isOverride && canEditSingle && target.initialScope === "once" ? "once" : "whole"
  )
  const singleDrop = useMemo<ScheduleDrop>(
    () =>
      singleOccurrence
        ? {
            selection: {
              kind: "course",
              date: singleOccurrence.date,
              courses: [singleOccurrence],
            },
            targetDate: singleOccurrence.date,
            targetStartSection: singleOccurrence.startSection,
          }
        : EMPTY_DROP,
    [singleOccurrence]
  )
  const singleForm = useSchedulePatchForm({
    drop: singleDrop,
    courses,
    periods,
    termStartDate,
    totalWeeks,
    t,
    onSave: (draft) => {
      onSaveSinglePatch?.(draft)
      onClose()
    },
  })

  const initialPeriod =
    target.mode === "create" && target.initialSection
      ? periods.find((p) => p.section === target.initialSection)
      : undefined
  const initialStartMin = initialPeriod?.startMinute ?? 19 * 60
  const initialEndMin = initialPeriod?.endMinute
    ? Math.max(initialPeriod.endMinute, initialStartMin + 60)
    : initialStartMin + 90

  const [kind, setKind] = useState<CustomScheduleKind>(() => {
    if (isOverride) return "course"
    if (isEditCustom) return target.item.kind
    return target.initialKind ?? (hasAcademicScope ? "course" : "event")
  })

  const [title, setTitle] = useState(() => {
    if (isOverride) return target.existingOverride?.name ?? target.rawCourse.name
    if (isEditCustom) return target.item.title
    return ""
  })
  const [deliveryMode, setDeliveryMode] = useState<ScheduleDeliveryMode>(() => {
    if (isOverride) {
      return target.existingOverride?.deliveryMode ?? target.rawCourse.deliveryMode ?? "in_person"
    }
    if (isEditCustom) return target.item.deliveryMode ?? "in_person"
    return "in_person"
  })
  const [location, setLocation] = useState(() => {
    if (isOverride) return target.existingOverride?.classroom ?? target.rawCourse.classroom ?? ""
    if (isEditCustom) return target.item.location ?? ""
    return ""
  })
  const [teacher, setTeacher] = useState(() => {
    if (isOverride) return target.existingOverride?.teacher ?? target.rawCourse.teacher ?? ""
    if (isEditCustom) return target.item.teacher ?? ""
    return ""
  })
  const [note, setNote] = useState(() => {
    if (isOverride) return target.existingOverride?.note ?? target.rawCourse.note ?? ""
    if (isEditCustom) return target.item.note ?? ""
    return ""
  })
  const [weekDay, setWeekDay] = useState<number>(() => {
    if (isOverride) return target.existingOverride?.weekDay ?? target.rawCourse.weekDay
    if (isEditCustom) return target.item.weekDay ?? 1
    return target.initialDay ?? 1
  })
  const [startSection, setStartSection] = useState<number>(() => {
    if (isOverride) return target.existingOverride?.startSection ?? target.rawCourse.startSection
    if (isEditCustom) return target.item.startSection ?? 1
    return target.initialSection ?? 1
  })
  const [endSection, setEndSection] = useState<number>(() => {
    if (isOverride) return target.existingOverride?.endSection ?? target.rawCourse.endSection
    if (isEditCustom) return target.item.endSection ?? 2
    return Math.min(maxSection, (target.initialSection ?? 1) + 1)
  })
  const [recurrence, setRecurrence] = useState<CustomScheduleRecurrence>(() => {
    if (isOverride) return "academic-weeks"
    if (isEditCustom) return target.item.recurrence
    if (kind === "course") return hasAcademicScope ? "academic-weeks" : "weekly"
    return target.initialDate ? "once" : "weekly"
  })
  const [date, setDate] = useState(() => {
    if (isEditCustom) return target.item.date ?? ""
    if (target.mode === "create" && target.initialDate) return target.initialDate
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  })
  const [startTime, setStartTime] = useState(() => {
    if (isEditCustom && typeof target.item.startMinute === "number") {
      return formatClockMinute(target.item.startMinute)
    }
    return formatClockMinute(initialStartMin)
  })
  const [endTime, setEndTime] = useState(() => {
    if (isEditCustom && typeof target.item.endMinute === "number") {
      return formatClockMinute(target.item.endMinute)
    }
    return formatClockMinute(initialEndMin)
  })
  const [selectedWeeks, setSelectedWeeks] = useState<number[]>(() => {
    if (isOverride) {
      if (target.existingOverride?.weekList?.length) return [...target.existingOverride.weekList]
      if (target.rawCourse.weekList?.length) return [...target.rawCourse.weekList]
      const parsed = parseWeeks(target.rawCourse.weeks ?? "")
      if (parsed.length > 0) return parsed
    }
    if (isEditCustom && target.item.weekList?.length) {
      return [...target.item.weekList]
    }
    return Array.from({ length: Math.min(totalWeeks, 16) }, (_, i) => i + 1)
  })
  const [remindable, setRemindable] = useState<boolean>(() => {
    if (isEditCustom) return target.item.remindable !== false
    return true
  })

  const allWeeks = Array.from({ length: totalWeeks }, (_, i) => i + 1)
  const selectedWeekSet = new Set(selectedWeeks)
  const toggleWeek = (week: number): void => {
    setSelectedWeeks((prev) =>
      prev.includes(week)
        ? prev.filter((item) => item !== week)
        : [...prev, week].sort((a, b) => a - b)
    )
  }

  const handleKindChange = (nextKind: CustomScheduleKind): void => {
    setKind(nextKind)
    if (nextKind === "course") {
      setRecurrence(hasAcademicScope ? "academic-weeks" : "weekly")
    } else if (recurrence === "academic-weeks") {
      setRecurrence("once")
    }
  }

  const handleSubmit = (): void => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error(t("scheduleCustom.validationTitle"))
      return
    }

    const nowIso = new Date().toISOString()

    if (isOverride) {
      if (selectedWeeks.length === 0) {
        toast.error(t("scheduleCustom.validationWeeks"))
        return
      }
      const clampedStart = Math.max(1, Math.min(maxSection, Math.round(startSection)))
      const clampedEnd = Math.max(clampedStart, Math.min(maxSection, Math.round(endSection)))
      onSaveOverride({
        courseKey: target.courseKey,
        originalName: target.rawCourse.name,
        hidden: false,
        name: trimmedTitle,
        classroom: location.trim(),
        teacher: teacher.trim(),
        weekDay,
        startSection: clampedStart,
        endSection: clampedEnd,
        weekList: [...selectedWeeks].sort((a, b) => a - b),
        deliveryMode,
        note: note.trim(),
        updatedAt: nowIso,
      })
      onClose()
      return
    }

    const timeMode = kind === "course" ? "section" : "time"
    if (timeMode === "section") {
      if (recurrence === "academic-weeks" && selectedWeeks.length === 0) {
        toast.error(t("scheduleCustom.validationWeeks"))
        return
      }
      const clampedStart = Math.max(1, Math.min(maxSection, Math.round(startSection)))
      const clampedEnd = Math.max(clampedStart, Math.min(maxSection, Math.round(endSection)))
      const item: CustomScheduleItem = {
        id: isEditCustom ? target.item.id : crypto.randomUUID(),
        kind: "course",
        title: trimmedTitle,
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(teacher.trim() ? { teacher: teacher.trim() } : {}),
        deliveryMode,
        ...(note.trim() ? { note: note.trim() } : {}),
        remindable,
        timeMode: "section",
        startSection: clampedStart,
        endSection: clampedEnd,
        recurrence: hasAcademicScope ? recurrence : "weekly",
        weekDay,
        ...(recurrence === "academic-weeks"
          ? { weekList: [...selectedWeeks].sort((a, b) => a - b) }
          : {}),
        semesterScope: recurrence === "academic-weeks" ? semesterScope : null,
        createdAt: isEditCustom ? target.item.createdAt : nowIso,
        updatedAt: nowIso,
      }
      onSaveCustom(item)
      onClose()
      return
    }

    const startMin = parseHHMM(startTime)
    const endMin = parseHHMM(endTime)
    if (startMin === null || endMin === null || endMin <= startMin) {
      toast.error(t("scheduleCustom.validationTime"))
      return
    }
    if (recurrence === "once" && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error(t("scheduleCustom.validationDate"))
      return
    }

    const item: CustomScheduleItem = {
      id: isEditCustom ? target.item.id : crypto.randomUUID(),
      kind: "event",
      title: trimmedTitle,
      ...(location.trim() ? { location: location.trim() } : {}),
      deliveryMode,
      ...(note.trim() ? { note: note.trim() } : {}),
      remindable,
      timeMode: "time",
      startMinute: startMin,
      endMinute: endMin,
      recurrence: recurrence === "once" ? "once" : "weekly",
      ...(recurrence === "once" ? { date } : { weekDay }),
      semesterScope: null,
      createdAt: isEditCustom ? target.item.createdAt : nowIso,
      updatedAt: nowIso,
    }
    onSaveCustom(item)
    onClose()
  }

  const weekdayLabels = [
    t("weekdayShort.1"),
    t("weekdayShort.2"),
    t("weekdayShort.3"),
    t("weekdayShort.4"),
    t("weekdayShort.5"),
    t("weekdayShort.6"),
    t("weekdayShort.7"),
  ]

  const modalTitle = isOverride
    ? t("scheduleCustom.editCourseTitle")
    : isEditCustom
      ? t("scheduleCustom.editCustomTitle")
      : t("scheduleCustom.createTitle")
  const modalDesc = isOverride ? t("scheduleCustom.editCourseDesc") : t("scheduleCustom.createDesc")

  return (
    <>
      <ResponsiveModalHeader>
        <ResponsiveModalTitle>{modalTitle}</ResponsiveModalTitle>
        <ResponsiveModalDescription>{modalDesc}</ResponsiveModalDescription>
      </ResponsiveModalHeader>
      <ResponsiveModalBody className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        {isOverride && canEditSingle && singleOccurrence && (
          <ToggleGroup
            type="single"
            value={editScope}
            onValueChange={(value) => {
              if (value === "whole" || value === "once") setEditScope(value)
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <ToggleGroupItem value="whole" className="flex-1">
              {t("scheduleCustom.editScopeWhole")}
            </ToggleGroupItem>
            <ToggleGroupItem value="once" className="flex-1">
              {t("scheduleCustom.editScopeOnce", { date: singleOccurrence.date.slice(5) })}
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        {!isOverride && (
          <ToggleGroup
            type="single"
            value={kind}
            onValueChange={(value) => {
              if (value === "course" || value === "event") {
                handleKindChange(value)
              }
            }}
            variant="outline"
            size="sm"
            className="w-full"
          >
            <ToggleGroupItem value="course" className="flex-1">
              {t("scheduleCustom.kindCourse")}
            </ToggleGroupItem>
            <ToggleGroupItem value="event" className="flex-1">
              {t("scheduleCustom.kindEvent")}
            </ToggleGroupItem>
          </ToggleGroup>
        )}

        {isOverride && editScope === "once" && singleOccurrence ? (
          <SchedulePatchFormBody form={singleForm} showSource={false} allowClear t={t} />
        ) : (
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="schedule-custom-title">
                {t("scheduleCustom.titleLabel")}
              </FieldLabel>
              <Input
                id="schedule-custom-title"
                value={title}
                maxLength={80}
                placeholder={
                  kind === "course"
                    ? t("scheduleCustom.titleCoursePlaceholder")
                    : t("scheduleCustom.titleEventPlaceholder")
                }
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>

            <Field>
              <FieldLabel>{t("scheduleCustom.deliveryLabel")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={deliveryMode}
                onValueChange={(value) => {
                  if (value === "in_person" || value === "online") setDeliveryMode(value)
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
              <FieldLabel htmlFor="schedule-custom-location">
                {t("scheduleCustom.locationLabel")}
              </FieldLabel>
              <Input
                id="schedule-custom-location"
                value={location}
                maxLength={100}
                placeholder={
                  deliveryMode === "online"
                    ? t("scheduleCustom.locationOnlinePlaceholder")
                    : t("scheduleCustom.locationPlaceholder")
                }
                onChange={(event) => setLocation(event.target.value)}
              />
            </Field>

            {kind === "course" && (
              <Field>
                <FieldLabel htmlFor="schedule-custom-teacher">
                  {t("scheduleCustom.teacherLabel")}
                </FieldLabel>
                <Input
                  id="schedule-custom-teacher"
                  value={teacher}
                  maxLength={60}
                  placeholder={t("scheduleCustom.teacherPlaceholder")}
                  onChange={(event) => setTeacher(event.target.value)}
                />
              </Field>
            )}

            {kind === "course" ? (
              <>
                <Field>
                  <FieldLabel>{t("scheduleCustom.weekdayLabel")}</FieldLabel>
                  <div className="grid grid-cols-7 gap-1">
                    {weekdayLabels.map((label, idx) => {
                      const day = idx + 1
                      const active = weekDay === day
                      return (
                        <Button
                          key={day}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="h-8 px-1 text-xs"
                          onClick={() => setWeekDay(day)}
                        >
                          {label}
                        </Button>
                      )
                    })}
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="schedule-custom-start-section">
                      {t("scheduleCustom.startSectionLabel")}
                    </FieldLabel>
                    <Input
                      id="schedule-custom-start-section"
                      type="number"
                      min={1}
                      max={maxSection}
                      value={startSection}
                      onChange={(event) => {
                        const next = Number.parseInt(event.target.value, 10) || 1
                        setStartSection(next)
                        if (endSection < next) setEndSection(next)
                      }}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="schedule-custom-end-section">
                      {t("scheduleCustom.endSectionLabel")}
                    </FieldLabel>
                    <Input
                      id="schedule-custom-end-section"
                      type="number"
                      min={startSection}
                      max={maxSection}
                      value={endSection}
                      onChange={(event) =>
                        setEndSection(Number.parseInt(event.target.value, 10) || startSection)
                      }
                    />
                  </Field>
                </div>

                {!isOverride && hasAcademicScope && (
                  <Field>
                    <FieldLabel>{t("scheduleCustom.recurrenceLabel")}</FieldLabel>
                    <ToggleGroup
                      type="single"
                      value={recurrence === "weekly" ? "weekly" : "academic-weeks"}
                      onValueChange={(value) => {
                        if (value === "weekly" || value === "academic-weeks") setRecurrence(value)
                      }}
                      variant="outline"
                      size="sm"
                    >
                      <ToggleGroupItem value="academic-weeks">
                        {t("scheduleCustom.recurrenceAcademicWeeks")}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="weekly">
                        {t("scheduleCustom.recurrenceWeekly")}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                )}

                {(isOverride || (hasAcademicScope && recurrence === "academic-weeks")) && (
                  <Field>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <FieldLabel>
                        {t("scheduleCustom.weeksLabel")}
                        {selectedWeeks.length > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            ({formatWeekList(selectedWeeks)})
                          </span>
                        )}
                      </FieldLabel>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setSelectedWeeks(allWeeks)}
                        >
                          {t("scheduleCustom.weeksAll")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setSelectedWeeks(allWeeks.filter((w) => w % 2 === 1))}
                        >
                          {t("scheduleCustom.weeksOdd")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setSelectedWeeks(allWeeks.filter((w) => w % 2 === 0))}
                        >
                          {t("scheduleCustom.weeksEven")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => setSelectedWeeks([])}
                        >
                          {t("scheduleCustom.weeksClear")}
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
                      {allWeeks.map((week) => {
                        const active = selectedWeekSet.has(week)
                        return (
                          <Button
                            key={week}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className="h-7 px-0 text-xs tabular-nums"
                            onClick={() => toggleWeek(week)}
                          >
                            {week}
                          </Button>
                        )
                      })}
                    </div>
                  </Field>
                )}
              </>
            ) : (
              <>
                <Field>
                  <FieldLabel>{t("scheduleCustom.recurrenceLabel")}</FieldLabel>
                  <ToggleGroup
                    type="single"
                    value={recurrence === "once" ? "once" : "weekly"}
                    onValueChange={(value) => {
                      if (value === "once" || value === "weekly") setRecurrence(value)
                    }}
                    variant="outline"
                    size="sm"
                  >
                    <ToggleGroupItem value="once">
                      {t("scheduleCustom.recurrenceOnce")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="weekly">
                      {t("scheduleCustom.recurrenceWeekly")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>

                {recurrence === "once" ? (
                  <Field>
                    <FieldLabel htmlFor="schedule-custom-date">
                      {t("scheduleCustom.dateLabel")}
                    </FieldLabel>
                    <Input
                      id="schedule-custom-date"
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel>{t("scheduleCustom.weekdayLabel")}</FieldLabel>
                    <div className="grid grid-cols-7 gap-1">
                      {weekdayLabels.map((label, idx) => {
                        const day = idx + 1
                        const active = weekDay === day
                        return (
                          <Button
                            key={day}
                            type="button"
                            size="sm"
                            variant={active ? "default" : "outline"}
                            className="h-8 px-1 text-xs"
                            onClick={() => setWeekDay(day)}
                          >
                            {label}
                          </Button>
                        )
                      })}
                    </div>
                  </Field>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="schedule-custom-start-time">
                      {t("scheduleCustom.startTimeLabel")}
                    </FieldLabel>
                    <Input
                      id="schedule-custom-start-time"
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="schedule-custom-end-time">
                      {t("scheduleCustom.endTimeLabel")}
                    </FieldLabel>
                    <Input
                      id="schedule-custom-end-time"
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}

            <Field>
              <FieldLabel htmlFor="schedule-custom-note">
                {t("scheduleCustom.noteLabel")}
              </FieldLabel>
              <Textarea
                id="schedule-custom-note"
                rows={2}
                maxLength={300}
                value={note}
                placeholder={t("scheduleCustom.notePlaceholder")}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>

            {!isOverride && (
              <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                <span className="text-sm">{t("scheduleCustom.remindLabel")}</span>
                <Switch checked={remindable} onCheckedChange={setRemindable} />
              </div>
            )}
          </FieldGroup>
        )}
      </ResponsiveModalBody>
      <ResponsiveModalFooter className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isOverride && editScope === "whole" && target.existingOverride && onRestoreOverride && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onRestoreOverride(target.courseKey, target.rawCourse.name)
                onClose()
              }}
            >
              <RotateCcw data-icon="inline-start" />
              {t("scheduleCustom.restoreCourse")}
            </Button>
          )}
          {isEditCustom && onDeleteCustom && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                onDeleteCustom(target.item.id, target.item.title)
                onClose()
              }}
            >
              <Trash2 data-icon="inline-start" />
              {t("scheduleCustom.delete")}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("scheduleEditor.cancel")}
          </Button>
          {isOverride && editScope === "once" ? (
            <SchedulePatchFormActions form={singleForm} t={t} />
          ) : (
            <Button type="button" data-schedule-custom-save="" onClick={handleSubmit}>
              {t("scheduleCustom.save")}
            </Button>
          )}
        </div>
      </ResponsiveModalFooter>
    </>
  )
}

export function ScheduleEntryDetailDialog({
  entry,
  customItem,
  t,
  extraDetailNode,
  onClose,
  onEditCustom,
  onDeleteCustom,
}: {
  readonly entry: ScheduleEntry | null
  readonly customItem?: CustomScheduleItem | null
  readonly t: Translator<ScheduleDictionary>
  readonly extraDetailNode?: ReactNode
  readonly onClose: () => void
  readonly onEditCustom?: (item: CustomScheduleItem) => void
  readonly onDeleteCustom?: (id: string, title: string) => void
}): ReactNode {
  const timeText =
    typeof entry?.metadata?.timeText === "string" && entry.metadata.timeText
      ? entry.metadata.timeText
      : entry?.time
        ? formatMinuteRange(entry.time.startMinute, entry.time.endMinute)
        : undefined
  const seatNumber =
    typeof entry?.metadata?.seatNumber === "string" ? entry.metadata.seatNumber : undefined

  return (
    <ResponsiveModal
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ResponsiveModalContent className="sm:max-w-md" aria-describedby={undefined}>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{entry?.title || t("schedule.entryDetail")}</ResponsiveModalTitle>
          {entry && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
              {(entry.badge || entry.category === "exam") && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "h-5 px-1.5 text-[10px]",
                    entry.category === "exam" &&
                      "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  )}
                >
                  {entry.badge || t("schedule.examTag")}
                </Badge>
              )}
              {entry.deliveryMode === "online" && (
                <Badge
                  variant="outline"
                  className="h-5 border-sky-500/40 bg-sky-500/15 px-1.5 text-[10px] text-sky-700 dark:text-sky-300"
                >
                  <Globe className="mr-0.5 size-3" />
                  {t("schedule.deliveryOnline")}
                </Badge>
              )}
              {entry.subtitle && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {entry.subtitle}
                </Badge>
              )}
            </div>
          )}
        </ResponsiveModalHeader>
        <ResponsiveModalBody className="flex flex-col gap-3">
          {entry && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
              {entry.date && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Calendar className="size-3.5" />
                    {t("scheduleCustom.dateLabel")}
                  </span>
                  <span>{entry.date}</span>
                </div>
              )}
              {timeText && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    {t("schedule.examTime")}
                  </span>
                  <span>{timeText}</span>
                </div>
              )}
              {entry.sections && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("schedule.sections")}</span>
                  <span>
                    {t("scheduleEditor.sectionRange", {
                      start: entry.sections.startSection,
                      end: entry.sections.endSection,
                    })}
                  </span>
                </div>
              )}
              {entry.location && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <MapPin className="size-3.5" />
                    {t("schedule.location")}
                  </span>
                  <span className="text-right">{entry.location}</span>
                </div>
              )}
              {seatNumber && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("schedule.examSeat")}</span>
                  <span>{seatNumber}</span>
                </div>
              )}
              {entry.note && (
                <div className="flex flex-col gap-1 border-t border-border/50 pt-2">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <StickyNote className="size-3.5" />
                    {t("schedule.note")}
                  </span>
                  <p className="whitespace-pre-wrap text-foreground">{entry.note}</p>
                </div>
              )}
            </div>
          )}

          {extraDetailNode}
        </ResponsiveModalBody>
        {customItem && (onEditCustom || onDeleteCustom) && (
          <ResponsiveModalFooter className="flex items-center justify-end gap-2">
            {onDeleteCustom && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  onDeleteCustom(customItem.id, customItem.title)
                  onClose()
                }}
              >
                <Trash2 data-icon="inline-start" />
                {t("scheduleCustom.delete")}
              </Button>
            )}
            {onEditCustom && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onClose()
                  onEditCustom(customItem)
                }}
              >
                <Pencil data-icon="inline-start" />
                {t("scheduleCustom.edit")}
              </Button>
            )}
          </ResponsiveModalFooter>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
