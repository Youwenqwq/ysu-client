import { UserRound } from "lucide-react"
import { hasSlice, requireSlice, type StudentInfo } from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { studentInfoDictionary, type StudentInfoDictionary } from "./dictionary"
import { StudentInfoPage, type StudentInfoPageInject, type StudentInfoPageProps } from "./page"

export const STUDENT_INFO_PLUGIN_ID = "orahako.student-info"

const LONG_TTL_MS = 1000 * 60 * 60 * 24 * 7

export type { StudentInfoDictionary, StudentInfoPageInject, StudentInfoPageProps }

const studentInfoManifest: PluginManifest = {
  id: STUDENT_INFO_PLUGIN_ID,
  name: "学生信息",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "个人学籍与身份信息",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const studentInfoPlugin = definePlugin({
  manifest: studentInfoManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(studentInfoDictionary)
    let disposed = false

    query.registerPolicy("student-info", { ttl: LONG_TTL_MS, persist: true })

    const studentInfoSource = query.source<StudentInfo, "studentProfile">({
      feature: "student-info",
      slice: "studentProfile",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        hasSlice(provider.getSnapshot().provider, "studentProfile"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "studentProfile").getStudentInfo(),
    })

    ui.registerPage(
      {
        id: "index",
        route: "student-info",
        title: "学生信息",
        titleKey: "pageTitle",
        capability: "studentProfile",
        parent: "me",
        dictionary: studentInfoDictionary,
        inject: (): StudentInfoPageInject => ({
          hooks: {
            student: studentInfoSource,
          },
        }),
      },
      StudentInfoPage
    )

    ui.registerNavigation({
      id: "student-info",
      title: "学生信息",
      titleKey: "navTitle",
      page: "index",
      icon: UserRound,
      group: "academic",
      order: 70,
      capability: "studentProfile",
    })

    ctx.effect(() => () => {
      disposed = true
    })
  },
})

export default studentInfoPlugin
