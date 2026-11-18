import { BookOpen } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  type AcademicCompletion,
  type AcademicWarning,
  type TrainingPlan,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { trainingPlanDictionary, type TrainingPlanDictionary } from "./dictionary"
import {
  TrainingPlanPage,
  type TrainingPlanFilterInput,
  type TrainingPlanPageInject,
  type TrainingPlanPageProps,
} from "./page"

export const TRAINING_PLAN_PLUGIN_ID = "orahako.training-plan"

export type {
  TrainingPlanDictionary,
  TrainingPlanFilterInput,
  TrainingPlanPageInject,
  TrainingPlanPageProps,
}

const trainingPlanManifest: PluginManifest = {
  id: TRAINING_PLAN_PLUGIN_ID,
  name: "培养方案",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "学业完成情况、重新计算与个人培养方案课程列表",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const trainingPlanPlugin = definePlugin({
  manifest: trainingPlanManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(trainingPlanDictionary)
    let disposed = false

    const plansSource = query.source<TrainingPlan[], "trainingPlan">({
      feature: "training-plan",
      slice: "trainingPlan",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        hasSlice(provider.getSnapshot().provider, "trainingPlan"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "trainingPlan").getTrainingPlan(),
    })

    const completionSource = query.source<AcademicCompletion, "trainingPlan">({
      feature: "academic-completion",
      slice: "trainingPlan",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(provider.getSnapshot().provider?.slices.trainingPlan?.getAcademicCompletion),
      fetcher: async (activeProvider) => {
        const slice = requireSlice(activeProvider, "trainingPlan")
        if (!slice.getAcademicCompletion) {
          throw new Error("Academic completion query is unavailable")
        }
        return slice.getAcademicCompletion()
      },
    })

    const warningsSource = query.source<AcademicWarning[], "trainingPlan">({
      feature: "academic-warnings",
      slice: "trainingPlan",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(provider.getSnapshot().provider?.slices.trainingPlan?.getAcademicWarnings),
      fetcher: async (activeProvider) => {
        const slice = requireSlice(activeProvider, "trainingPlan")
        if (!slice.getAcademicWarnings) {
          throw new Error("Academic warnings query is unavailable")
        }
        return slice.getAcademicWarnings()
      },
    })

    const recalculateCompletion = async (): Promise<AcademicCompletion> => {
      const activeProvider = provider.getActive()
      const slice = requireSlice(activeProvider, "trainingPlan")
      if (!slice.recalculateAcademicCompletion) {
        throw new Error("Academic completion recalculation is unavailable")
      }
      const updated = await slice.recalculateAcademicCompletion()
      query.invalidate({ feature: "academic-completion" })
      query.invalidate({ feature: "academic-warnings" })
      query.invalidate({ feature: "training-plan" })
      await completionSource.getSnapshot().refresh()
      return updated
    }

    ui.registerPage(
      {
        id: "index",
        route: "training-plan",
        title: "培养方案",
        titleKey: "pageTitle",
        capability: "trainingPlan",
        dictionary: trainingPlanDictionary,
        inject: (): TrainingPlanPageInject => ({
          hooks: {
            plans: plansSource,
            completion: completionSource,
            warnings: warningsSource,
            provider: provider.state,
          },
          recalculateCompletion,
        }),
      },
      TrainingPlanPage
    )

    ui.registerNavigation({
      id: "training-plan",
      title: "培养方案",
      titleKey: "navTitle",
      page: "index",
      icon: BookOpen,
      group: "academic",
      order: 50,
      capability: "trainingPlan",
    })

    ctx.effect(() => () => {
      disposed = true
    })
  },
})

export default trainingPlanPlugin
