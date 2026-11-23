import { ClipboardCheck, ListChecks } from "lucide-react"
import {
  requireSlice,
  type EvaluationDetail,
  type EvaluationDetailQuery,
  type EvaluationScoreInput,
  type EvaluationSubmitInput,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { evaluationDictionary, type EvaluationDictionary } from "./dictionary"
import {
  EvaluationHeaderActions,
  type EvaluationHeaderActionsInject,
  type EvaluationHeaderActionsProps,
} from "./header-actions"
import {
  createEvaluationSources,
  type BatchTaskResult,
  type EvaluationSources,
  type TaskStatusDisplay,
} from "./helpers"
import { EvaluationPage, type EvaluationPageInject, type EvaluationPageProps } from "./page"
import "./slots"
import {
  evaluationViewStore,
  type EvaluationViewState,
  type EvaluationViewStoreInstance,
} from "./view-store"
import {
  PENDING_EVALUATIONS_WIDGET_ID,
  PendingEvaluationsWidget,
  type PendingEvaluationsWidgetInject,
  type PendingEvaluationsWidgetProps,
} from "./widgets"

export const EVALUATION_PLUGIN_ID = "orahako.evaluation"

export type {
  BatchTaskResult,
  EvaluationDictionary,
  EvaluationHeaderActionsInject,
  EvaluationHeaderActionsProps,
  EvaluationPageInject,
  EvaluationPageProps,
  EvaluationSources,
  EvaluationViewState,
  EvaluationViewStoreInstance,
  PendingEvaluationsWidgetInject,
  PendingEvaluationsWidgetProps,
  TaskStatusDisplay,
}

const EVALUATION_INJECT = [
  "ui",
  "slots",
  "router",
  "i18n",
  "provider",
  "session",
  "query",
  "overview",
] as const

const evaluationManifest: PluginManifest = {
  id: EVALUATION_PLUGIN_ID,
  name: "学生评教",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "选择评教类型、填写问卷、批量自动评教与待办总览卡片",
  inject: [...EVALUATION_INJECT],
}

export const evaluationPlugin = definePlugin({
  manifest: evaluationManifest,
  inject: EVALUATION_INJECT,
  apply(ctx) {
    const { ui, slots, router, i18n, provider, session, query, overview } = ctx
    i18n.register(evaluationDictionary)

    const sources = createEvaluationSources({ query, provider, session })
    const viewStore = evaluationViewStore.create()

    const fetchDetail = async (detailQuery: EvaluationDetailQuery): Promise<EvaluationDetail> => {
      const slice = requireSlice(provider.getActive(), "evaluation")
      return slice.getEvaluationDetail(detailQuery)
    }

    const calculateScore = async (
      input: EvaluationScoreInput
    ): Promise<Record<string, unknown> | null> => {
      const slice = requireSlice(provider.getActive(), "evaluation")
      if (!slice.calculateEvaluationScore) {
        return null
      }
      return slice.calculateEvaluationScore(input)
    }

    const submitEvaluation = async (input: EvaluationSubmitInput): Promise<void> => {
      const slice = requireSlice(provider.getActive(), "evaluation")
      await slice.submitEvaluation(input)
      query.invalidate({ feature: "evaluation-types" })
      query.invalidate({ feature: "pending-evaluations" })
      query.invalidate({ feature: "evaluation-tasks" })
    }

    overview.registerWidget(
      {
        id: PENDING_EVALUATIONS_WIDGET_ID,
        title: "评教任务",
        titleKey: "widget.title",
        description: "有待办时显示需要完成的评教任务。",
        descriptionKey: "widget.description",
        icon: ListChecks,
        region: "content",
        defaultVisible: true,
        order: 75,
        slice: "evaluation",
        dictionary: evaluationDictionary,
        inject: (): PendingEvaluationsWidgetInject => ({
          hooks: {
            tasks: sources.allTasksSource,
          },
          evaluationHref: router.href({ route: "evaluation" }),
          openEvaluation: () => {
            router.push({ route: "evaluation" })
          },
        }),
      },
      PendingEvaluationsWidget
    )

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "evaluation-header-actions",
          slot: "shell.header.actions",
          dictionary: evaluationDictionary,
          store: viewStore,
          inject: (): EvaluationHeaderActionsInject => ({
            hooks: {
              location: router.current,
              provider: provider.state,
              types: sources.typesSource,
              selectedType: sources.selectedTypeSource,
              tasks: sources.pendingTasksSource,
            },
            pluginId: EVALUATION_PLUGIN_ID,
            selectType: sources.selectType,
          }),
        },
        EvaluationHeaderActions
      )
    )

    ui.registerPage(
      {
        id: "index",
        route: "evaluation",
        title: "学生评教",
        titleKey: "pageTitle",
        capability: "evaluation",
        dictionary: evaluationDictionary,
        store: viewStore,
        inject: (): EvaluationPageInject => ({
          hooks: {
            types: sources.typesSource,
            selectedType: sources.selectedTypeSource,
            tasks: sources.pendingTasksSource,
            provider: provider.state,
          },
          selectType: sources.selectType,
          fetchDetail,
          calculateScore,
          submitEvaluation,
        }),
      },
      EvaluationPage
    )

    ui.registerNavigation({
      id: "evaluation",
      title: "学生评教",
      titleKey: "navTitle",
      page: "index",
      icon: ClipboardCheck,
      group: "academic",
      order: 60,
      capability: "evaluation",
    })

    ctx.effect(() => () => {
      viewStore.dispose()
      sources.dispose()
    })
  },
})

export default evaluationPlugin
