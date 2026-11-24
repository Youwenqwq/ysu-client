import { Gauge } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { comprehensiveDictionary, type ComprehensiveDictionary } from "./dictionary"
import { ComprehensiveHeaderActions, type ComprehensiveHeaderActionsInject } from "./header-actions"
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
import "./slots"
import { comprehensiveViewStore } from "./view-store"

export const COMPREHENSIVE_PLUGIN_ID = "orahako.comprehensive"

const SIX_HOUR_TTL_MS = 1000 * 60 * 60 * 6
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24

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
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query"],
}

export const comprehensivePlugin = definePlugin({
  manifest: comprehensiveManifest,
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, slots, router, i18n, provider, session, query } = ctx
    i18n.register(comprehensiveDictionary)

    query.registerPolicy("comprehensive-terms", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-result", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-indicators", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-radar", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-year-scores", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-report-years", { ttl: DEFAULT_TTL_MS, persist: true })
    query.registerPolicy("comprehensive-report", { ttl: SIX_HOUR_TTL_MS, persist: true })

    const sources = createComprehensiveSources({ query, provider, session })
    const viewStore = comprehensiveViewStore.create()

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "comprehensive-header-actions",
          slot: "shell.header.actions",
          dictionary: comprehensiveDictionary,
          store: viewStore,
          inject: (): ComprehensiveHeaderActionsInject => ({
            hooks: {
              location: router.current,
              provider: provider.state,
              terms: sources.termsSource,
              selectedTerm: sources.selectedTermSource,
            },
            pluginId: COMPREHENSIVE_PLUGIN_ID,
          }),
        },
        ComprehensiveHeaderActions
      )
    )

    ui.registerPage(
      {
        id: "index",
        route: "comprehensive",
        title: "综合测评",
        titleKey: "pageTitle",
        capability: "comprehensive",
        dictionary: comprehensiveDictionary,
        store: viewStore,
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
      viewStore.dispose()
    })
  },
})

export default comprehensivePlugin
