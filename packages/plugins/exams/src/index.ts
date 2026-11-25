import { Calendar, FileText } from "lucide-react"
import {
  formatExamTime,
  getAcademicClock,
  getExamEndTime,
  getExamStartTime,
} from "@orahako/academic-kit"
import { hasSlice, requireSlice, type Exam, type ProviderQueryPolicy } from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  WIDGETS_EXAM_CAPABILITY,
  WIDGETS_GENERIC_CAPABILITY,
  type PluginManifest,
  type ScheduleEntry,
} from "@orahako/sdk"
import { examsDictionary, type ExamsDictionary } from "./dictionary"
import { ExamsHeaderActions, type ExamsHeaderActionsInject } from "./header-actions"
import { UpcomingExamsWidget, type UpcomingExamsWidgetInject } from "./overview-widget"
import { ExamsPage, type ExamsPageInject } from "./page"
import {
  ExamCompactSettingsWidget,
  ExamNotificationContent,
  ExamSettingsWidget,
  type ExamWidgetPinInject,
} from "./settings"
import "./slots"
import {
  examsSettingsStore,
  examsViewStore,
  type ExamsSettingsState,
  type ExamsSettingsStoreInstance,
} from "./store"
import {
  clearExamWidgetSnapshots,
  createParameterizedExamQueryController,
  observeExamQueryForWidgets,
  syncExamWidgetSnapshots,
  type ExamWidgetId,
} from "./widget-sync"

export const EXAMS_PLUGIN_ID = "orahako.exams"

export type { ExamsDictionary, ExamsSettingsState, ExamsSettingsStoreInstance, ExamWidgetId }

const DAY_MS = 24 * 60 * 60 * 1000

const EXAMS_QUERY_POLICY: ProviderQueryPolicy = { ttl: DAY_MS, persist: true }

const examsManifest: PluginManifest = {
  id: EXAMS_PLUGIN_ID,
  name: "考试安排",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "学期考试安排查询、倒计时、桌面小组件同步与考试提醒通道",
  nativeCapabilities: [WIDGETS_GENERIC_CAPABILITY, WIDGETS_EXAM_CAPABILITY],
  inject: [
    "ui",
    "slots",
    "router",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
    "notifications",
    "native",
    "widgets",
  ],
}

export const examsPlugin = definePlugin({
  manifest: examsManifest,
  inject: [
    "ui",
    "slots",
    "router",
    "i18n",
    "storage",
    "provider",
    "session",
    "query",
    "notifications",
    "native",
    "widgets",
  ] as const,
  optionalInject: ["overview", "assets", "schedule"] as const,
  apply(ctx) {
    const {
      ui,
      slots,
      router,
      i18n,
      storage,
      provider,
      session,
      query,
      notifications,
      overview,
      assets,
      schedule,
      widgets,
    } = ctx

    i18n.register(examsDictionary)
    query.registerPolicy("exams", EXAMS_QUERY_POLICY)
    let disposed = false

    const settingsStore = examsSettingsStore.create(storage)
    const viewStore = examsViewStore.create()

    const clearExamWidgets = (): Promise<void> => clearExamWidgetSnapshots(widgets)

    const syncExamWidgets = (exams: readonly Exam[]): void => {
      if (disposed) return
      void syncExamWidgetSnapshots(widgets, exams)
    }

    const buildExamsSource = (semester: string) => {
      const rawSource = query.source<Exam[], "exams">({
        feature: "exams",
        slice: "exams",
        params: semester ? { semester } : undefined,
        enabled: () =>
          !disposed &&
          session.getSnapshot().isAuthenticated &&
          hasSlice(provider.getSnapshot().provider, "exams"),
        fetcher: async (activeProvider) => {
          const exams = await requireSlice(activeProvider, "exams").getExams(
            semester ? { semester } : undefined
          )
          if (!semester && !disposed) {
            syncExamWidgets(exams)
          }
          return exams
        },
      })
      return semester ? rawSource : observeExamQueryForWidgets(rawSource, syncExamWidgets)
    }

    const defaultExamsSource = buildExamsSource("")
    const pageExamsController = createParameterizedExamQueryController((semester) =>
      semester ? buildExamsSource(semester) : defaultExamsSource
    )

    // Publish exams into the open `schedule` service as a pluggable source.
    const scheduleExamsController = createParameterizedExamQueryController((semester) =>
      semester ? buildExamsSource(semester) : defaultExamsSource
    )
    const examEntriesSource = createObservableSource<readonly ScheduleEntry[]>([])
    const publishExamEntries = (): void => {
      if (disposed) return
      const exams = scheduleExamsController.source.getSnapshot().data ?? []
      const timeZone = provider.getSnapshot().provider?.slices.timetable?.scheduleRules?.timeZone
      const entries: ScheduleEntry[] = []
      for (let i = 0; i < exams.length; i += 1) {
        const exam = exams[i]!
        const startDate = getExamStartTime(exam, timeZone)
        const endDate = getExamEndTime(exam, timeZone)
        if (!startDate || !endDate) continue
        const startClock = getAcademicClock(startDate, timeZone)
        const endClock = getAcademicClock(endDate, timeZone)
        if (endClock.minutes <= startClock.minutes) continue
        entries.push({
          id: `exam:${exam.name}:${startClock.date}:${startClock.minutes}:${i}`,
          sourceId: "exams",
          sourcePluginId: EXAMS_PLUGIN_ID,
          category: "exam",
          title: exam.name,
          ...(exam.examName ? { subtitle: exam.examName } : {}),
          ...(exam.examLocation ? { location: exam.examLocation } : {}),
          date: startClock.date,
          weekDay: startClock.weekday,
          time: { startMinute: startClock.minutes, endMinute: endClock.minutes },
          remindable: false,
          metadata: {
            timeText: formatExamTime(exam),
            ...(exam.seatNumber ? { seatNumber: exam.seatNumber } : {}),
          },
        })
      }
      examEntriesSource.set(entries)
    }

    let detachScheduleExams: (() => void) | null = null
    let detachScheduleProvider: (() => void) | null = null
    let unregisterScheduleSource: (() => void) | null = null
    if (schedule) {
      detachScheduleExams = scheduleExamsController.source.subscribe(publishExamEntries)
      detachScheduleProvider = provider.state.subscribe(publishExamEntries)
      publishExamEntries()
      unregisterScheduleSource = schedule.registerSource({
        id: "exams",
        order: 40,
        category: "exam",
        entries: examEntriesSource,
        setSemester: (semester) => {
          scheduleExamsController.setTerm(semester)
        },
        refresh: async () => {
          await scheduleExamsController.refresh()
        },
      })
    }

    let unregisterChannel: (() => void) | null = null
    let lastNotifyExams = settingsStore.source.getSnapshot().notifyExams

    const registerExamsChannel = (notifyExams: boolean): void => {
      unregisterChannel?.()
      unregisterChannel = notifications.registerChannel({
        id: "exams",
        order: 20,
        slice: "exams",
        toPollingFlag: (enabled) => {
          const active = enabled && notifyExams
          return {
            checkExams: active,
            exams: active,
          }
        },
        onDisable: () => clearExamWidgets(),
        onEnable: () => {
          if (!settingsStore.source.getSnapshot().notifyExams) return
          const exams = defaultExamsSource.getSnapshot().data
          if (exams !== undefined) syncExamWidgets(exams)
        },
      })
    }

    registerExamsChannel(lastNotifyExams)
    const detachSettings = settingsStore.source.subscribe(() => {
      if (disposed) return
      const current = settingsStore.source.getSnapshot().notifyExams
      if (current !== lastNotifyExams) {
        const disabledNow = lastNotifyExams && !current
        lastNotifyExams = current
        registerExamsChannel(current)
        if (disabledNow) {
          void clearExamWidgets()
        }
      }
    })

    const resolveWidgetPreviewSrc = (fileName: string): string =>
      assets?.url(`widgets/${fileName}`) ?? router.href(`/widgets/${fileName}`)

    overview?.registerWidget(
      {
        id: "upcoming-exams",
        title: "近期考试",
        titleKey: "widgets.upcomingExams.title",
        description: "查看接下来的考试时间与地点。",
        descriptionKey: "widgets.upcomingExams.description",
        icon: Calendar,
        region: "content",
        defaultVisible: true,
        order: 60,
        slice: "exams",
        dictionary: examsDictionary,
        inject: (): UpcomingExamsWidgetInject => ({
          hooks: {
            exams: defaultExamsSource,
            provider: provider.state,
          },
          openExams: () => {
            router.push({ route: "exams" })
          },
        }),
      },
      UpcomingExamsWidget
    )

    slots.inject("settings.notifications.content", () =>
      slots.register(
        {
          id: "exams",
          slot: "settings.notifications.content",
          order: 20,
          dictionary: examsDictionary,
          store: settingsStore,
          inject: () => ({
            hooks: {
              provider: provider.state,
            },
          }),
        },
        ExamNotificationContent
      )
    )

    slots.inject("settings.widgets.add", () => {
      const disposeExam = slots.register(
        {
          id: "exam",
          slot: "settings.widgets.add",
          order: 20,
          dictionary: examsDictionary,
          inject: (): ExamWidgetPinInject => ({
            previewSrc: resolveWidgetPreviewSrc("exam.png"),
            requestPin: (widget) => widgets.requestPin(widget),
          }),
        },
        ExamSettingsWidget
      )
      const disposeCompact = slots.register(
        {
          id: "exam-compact",
          slot: "settings.widgets.add",
          order: 20,
          dictionary: examsDictionary,
          inject: (): ExamWidgetPinInject => ({
            previewSrc: resolveWidgetPreviewSrc("exam-compact.png"),
            requestPin: (widget) => widgets.requestPin(widget),
          }),
        },
        ExamCompactSettingsWidget
      )
      return () => {
        disposeCompact()
        disposeExam()
      }
    })

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "exams-header-actions",
          slot: "shell.header.actions",
          dictionary: examsDictionary,
          store: viewStore,
          inject: (): ExamsHeaderActionsInject => ({
            hooks: {
              location: router.current,
              provider: provider.state,
              queriedTerm: pageExamsController.term,
            },
            pluginId: EXAMS_PLUGIN_ID,
          }),
        },
        ExamsHeaderActions
      )
    )

    ui.registerPage(
      {
        id: "index",
        route: "exams",
        title: "考试安排",
        titleKey: "exams.title",
        capability: "exams",
        requiresProvider: true,
        dictionary: examsDictionary,
        store: viewStore,
        inject: (): ExamsPageInject => ({
          hooks: {
            exams: pageExamsController.source,
            provider: provider.state,
            queriedTerm: pageExamsController.term,
          },
          queryBySemester: async (semester: string) => {
            const trimmed = semester.trim()
            if (trimmed === pageExamsController.term.getSnapshot()) {
              await pageExamsController.refresh()
              return
            }
            pageExamsController.setTerm(trimmed)
          },
        }),
      },
      ExamsPage
    )

    ui.registerNavigation({
      id: "exams",
      title: "考试安排",
      titleKey: "navTitle",
      page: "index",
      icon: FileText,
      group: "academic",
      order: 30,
      capability: "exams",
    })

    ctx.effect(() => () => {
      disposed = true
      unregisterScheduleSource?.()
      unregisterScheduleSource = null
      detachScheduleExams?.()
      detachScheduleProvider?.()
      detachSettings()
      unregisterChannel?.()
      unregisterChannel = null
      scheduleExamsController.dispose()
      pageExamsController.dispose()
      viewStore.dispose()
      settingsStore.dispose()
      void clearExamWidgets()
    })
  },
})

export default examsPlugin
