import { ClipboardCheck, ListChecks } from "lucide-react"
import { definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { EvaluationPage } from "./page"
import { EvaluationSummaryWidget, EvaluationTasksWidget } from "./widgets"

export const manifest: PluginManifest = {
  id: "orahako.evaluation",
  name: "学生评教",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

export const definition = definePlugin((ctx) => {
  ctx.ui.registerOverviewWidget({
    id: "evaluation",
    title: "评教状态",
    titleKey: "overviewLayout.widgets.evaluation.title",
    description: "查看待完成的学生评教数量。",
    descriptionKey: "overviewLayout.widgets.evaluation.description",
    icon: ClipboardCheck,
    component: EvaluationSummaryWidget,
    region: "summary",
    defaultVisible: true,
    order: 30,
  })
  ctx.ui.registerOverviewWidget({
    id: "evaluation-tasks",
    title: "评教任务",
    titleKey: "overviewLayout.widgets.evaluationTasks.title",
    description: "有待办时显示需要完成的评教任务。",
    descriptionKey: "overviewLayout.widgets.evaluationTasks.description",
    icon: ListChecks,
    component: EvaluationTasksWidget,
    region: "content",
    defaultVisible: true,
    order: 70,
  })
  ctx.ui.registerPage({
    id: "index",
    title: "学生评教",
    titleKey: "evaluation.title",
    component: EvaluationPage,
    capability: "evaluation",
  })
  ctx.ui.registerNavigation({
    id: "evaluation",
    title: "学生评教",
    titleKey: "app.evaluation",
    page: "index",
    icon: ClipboardCheck,
    group: "academic",
    order: 60,
    capability: "evaluation",
  })
})
