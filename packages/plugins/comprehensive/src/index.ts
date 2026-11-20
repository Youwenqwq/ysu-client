import { Gauge } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { comprehensiveDictionary, type ComprehensiveDictionary } from "./dictionary"
import {
  ComprehensivePage,
  type ComprehensivePageInject,
  type ComprehensivePageProps,
} from "./page"
import {
  createComprehensiveSources,
  type ComprehensiveSources,
  type ComprehensiveTermSelection,
} from "./sources"

export const COMPREHENSIVE_PLUGIN_ID = "orahako.comprehensive"

export type {
  ComprehensiveDictionary,
  ComprehensivePageInject,
  ComprehensivePageProps,
  ComprehensiveSources,
  ComprehensiveTermSelection,
}

const comprehensiveManifest: PluginManifest = {
  id: COMPREHENSIVE_PLUGIN_ID,
  name: "综合测评",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "综测成绩、指标对比、历年总览与学业成绩报告",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const comprehensivePlugin = definePlugin({
  manifest: comprehensiveManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(comprehensiveDictionary)

    const sources = createComprehensiveSources({ query, provider, session })

    ui.registerPage(
      {
        id: "index",
        route: "comprehensive",
        title: "综合测评",
        titleKey: "pageTitle",
        capability: "comprehensive",
        dictionary: comprehensiveDictionary,
        inject: (): ComprehensivePageInject => ({
          hooks: {
            terms: sources.termsSource,
            selectedTerm: sources.selectedTermSource,
            result: sources.resultSource,
            indicators: sources.indicatorsSource,
            radar: sources.radarSource,
            yearScores: sources.yearScoresSource,
            reportYears: sources.reportYearsSource,
            selectedReportYear: sources.selectedReportYearSource,
            report: sources.reportSource,
          },
          selectTerm: sources.selectTerm,
          selectReportYear: sources.selectReportYear,
        }),
      },
      ComprehensivePage
    )

    ui.registerNavigation({
      id: "comprehensive",
      title: "综合测评",
      titleKey: "navTitle",
      page: "index",
      icon: Gauge,
      group: "platform",
      order: 30,
      capability: "comprehensive",
    })

    ctx.effect(() => () => {
      sources.dispose()
    })
  },
})

export default comprehensivePlugin
