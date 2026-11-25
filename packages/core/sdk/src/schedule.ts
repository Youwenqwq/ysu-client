import type { ObservableSource } from "./observable"

export type ScheduleEntryCategory = "course" | "exam" | "personal" | "custom"
export type ScheduleDeliveryMode = "in_person" | "online"

export interface ScheduleTimeRange {
  /** Minutes from local midnight (0..1439), e.g. 08:00 = 480. */
  readonly startMinute: number
  /** Minutes from local midnight (1..1440), e.g. 09:40 = 580. */
  readonly endMinute: number
}

export interface ScheduleSectionRange {
  readonly startSection: number
  readonly endSection: number
}

export interface ScheduleEntry {
  /** Globally unique stable ID within the schedule. */
  readonly id: string
  /** Optional logical series ID shared by recurring occurrences. */
  readonly seriesId?: string
  readonly sourceId: string
  readonly sourcePluginId: string
  readonly category: ScheduleEntryCategory
  readonly title: string
  readonly location?: string
  readonly subtitle?: string
  readonly deliveryMode?: ScheduleDeliveryMode
  readonly note?: string
  readonly colorKey?: string
  readonly badge?: string
  /** Concrete ISO date (YYYY-MM-DD) for dated occurrences. */
  readonly date?: string
  /** Weekday 1 (Monday) .. 7 (Sunday). */
  readonly weekDay: number
  /** Active 1-based academic week numbers when anchored to an academic calendar. */
  readonly weekList?: readonly number[]
  /** Class period sections when anchored to timetable sections. */
  readonly sections?: ScheduleSectionRange
  /** Clock time range in minutes from midnight. */
  readonly time?: ScheduleTimeRange
  /** Whether this entry should participate in reminders. */
  readonly remindable?: boolean
  /** Arbitrary structured metadata owned by the contributing source plugin. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ScheduleEntryDetailOwner {
  readonly entry: ScheduleEntry
  readonly date?: string
  readonly week?: number
}

export interface ScheduleSourceSpec {
  readonly id: string
  readonly name?: string
  readonly nameKey?: string
  readonly order?: number
  readonly category?: ScheduleEntryCategory
  readonly entries: ObservableSource<readonly ScheduleEntry[]>
  readonly refresh?: () => Promise<void> | void
  readonly setSemester?: (semester: string) => void
}

export interface ScheduleSourceContribution extends ScheduleSourceSpec {
  readonly pluginId: string
  readonly scopedId: string
}

export interface ScheduleEffectiveSnapshot {
  readonly entries: readonly ScheduleEntry[]
  readonly sources: readonly ScheduleSourceContribution[]
}

export interface ScheduleService {
  readonly sources: ObservableSource<readonly ScheduleSourceContribution[]>
  readonly state: ObservableSource<ScheduleEffectiveSnapshot>
  registerSource(spec: ScheduleSourceSpec): () => void
  getSources(): readonly ScheduleSourceContribution[]
  getEffectiveSnapshot(): ScheduleEffectiveSnapshot
  subscribe(listener: () => void): () => void
}
