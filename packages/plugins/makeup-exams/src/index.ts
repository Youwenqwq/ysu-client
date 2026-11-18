import { FilePenLine } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  type MakeupExamBatch,
  type MakeupExamCourse,
  type MakeupExamSignupInput,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { makeupExamsDictionary, type MakeupExamsDictionary } from "./dictionary"
import { MakeupExamsPage, type MakeupExamsPageInject } from "./page"
import { createMakeupCourseQueryController, type MakeupCourseFilter } from "./query-source"

export const MAKEUP_EXAMS_PLUGIN_ID = "orahako.makeup-exams"

export type { MakeupCourseFilter, MakeupExamsDictionary }

const makeupExamsManifest: PluginManifest = {
  id: MAKEUP_EXAMS_PLUGIN_ID,
  name: "补考查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "补考批次与课程查询及在线补考报名",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const makeupExamsPlugin = definePlugin({
  manifest: makeupExamsManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(makeupExamsDictionary)
    let disposed = false

    const batchesSource = query.source<MakeupExamBatch[], "makeupExams">({
      feature: "makeup-exam-batches",
      slice: "makeupExams",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        hasSlice(provider.getSnapshot().provider, "makeupExams"),
      fetcher: (activeProvider) =>
        requireSlice(activeProvider, "makeupExams").getMakeupExamBatches(),
    })

    const coursesController = createMakeupCourseQueryController((filter) =>
      query.source<MakeupExamCourse[], "makeupExams">({
        feature: "makeup-exam-courses",
        slice: "makeupExams",
        params: {
          batchId: filter.batchId ?? null,
          registered: filter.registered,
        },
        enabled: () =>
          !disposed &&
          Boolean(filter.batchId) &&
          session.getSnapshot().isAuthenticated &&
          hasSlice(provider.getSnapshot().provider, "makeupExams"),
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "makeupExams").getMakeupExamCourses({
            batchId: filter.batchId,
            registered: filter.registered,
          }),
      })
    )

    const signupMakeupExam = async (input: MakeupExamSignupInput): Promise<void> => {
      const activeProvider = provider.getActive()
      await requireSlice(activeProvider, "makeupExams").signupMakeupExam(input)
      await Promise.all([coursesController.refresh(), batchesSource.getSnapshot().refresh()])
    }

    ui.registerPage(
      {
        id: "index",
        route: "makeup-exams",
        title: "补考查询",
        titleKey: "makeupExams.title",
        capability: "makeupExams",
        requiresProvider: true,
        dictionary: makeupExamsDictionary,
        inject: (): MakeupExamsPageInject => ({
          hooks: {
            batches: batchesSource,
            courses: coursesController.source,
          },
          selectCourseFilter: (filter) => {
            coursesController.setFilter(filter)
          },
          signupMakeupExam,
        }),
      },
      MakeupExamsPage
    )

    ui.registerNavigation({
      id: "makeup-exams",
      title: "补考查询",
      titleKey: "navTitle",
      page: "index",
      icon: FilePenLine,
      group: "academic",
      order: 35,
      capability: "makeupExams",
    })

    ctx.effect(() => () => {
      disposed = true
      coursesController.dispose()
    })
  },
})

export default makeupExamsPlugin
