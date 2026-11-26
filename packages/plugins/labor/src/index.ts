import { Hammer } from "lucide-react"
import {
  hasSlice,
  requireSlice,
  type EnrollableActivity,
  type LaborRecord,
  type LaborSummary,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { laborDictionary, type LaborDictionary } from "./dictionary"
import {
  LaborPage,
  laborUiStore,
  type LaborPageInject,
  type LaborPageProps,
  type LaborTab,
  type LaborUiState,
  type LaborUiStoreInstance,
} from "./page"

export const LABOR_PLUGIN_ID = "orahako.labor"

const ONE_HOUR_TTL_MS = 1000 * 60 * 60
const SIX_HOUR_TTL_MS = 1000 * 60 * 60 * 6

export type {
  LaborDictionary,
  LaborPageInject,
  LaborPageProps,
  LaborTab,
  LaborUiState,
  LaborUiStoreInstance,
}

const laborManifest: PluginManifest = {
  id: LABOR_PLUGIN_ID,
  name: "劳动教育",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "劳动教育学分汇总、劳动记录与活动报名查询",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const laborPlugin = definePlugin({
  manifest: laborManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(laborDictionary)

    let disposed = false
    const uiStore = laborUiStore.create()

    query.registerPolicy("labor-summary", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("labor-records", { ttl: SIX_HOUR_TTL_MS, persist: true })
    query.registerPolicy("labor-activities", { ttl: ONE_HOUR_TTL_MS, persist: true })

    const isEnabled = (): boolean =>
      !disposed &&
      session.getSnapshot().isAuthenticated &&
      hasSlice(provider.getSnapshot().provider, "labor")

    const summarySource = query.source<LaborSummary, "labor">({
      feature: "labor-summary",
      slice: "labor",
      enabled: isEnabled,
      fetcher: (activeProvider) => requireSlice(activeProvider, "labor").getLaborSummary(),
    })

    const recordsSource = query.source<LaborRecord[], "labor">({
      feature: "labor-records",
      slice: "labor",
      enabled: isEnabled,
      fetcher: (activeProvider) => requireSlice(activeProvider, "labor").getLaborRecords(),
    })

    const activitiesSource = query.source<EnrollableActivity[], "labor">({
      feature: "labor-activities",
      slice: "labor",
      enabled: isEnabled,
      fetcher: (activeProvider) => requireSlice(activeProvider, "labor").getLaborActivities(),
    })

    ui.registerPage(
      {
        id: "index",
        route: "labor",
        title: "劳动教育",
        titleKey: "labor.title",
        capability: "labor",
        dictionary: laborDictionary,
        store: uiStore,
        inject: (): LaborPageInject => ({
          hooks: {
            summary: summarySource,
            records: recordsSource,
            activities: activitiesSource,
          },
        }),
      },
      LaborPage
    )

    ui.registerNavigation({
      id: "labor",
      title: "劳动教育",
      titleKey: "labor.nav",
      page: "index",
      icon: Hammer,
      group: "platform",
      order: 10,
      capability: "labor",
    })

    ctx.effect(() => () => {
      disposed = true
      uiStore.dispose()
    })
  },
})

export default laborPlugin
