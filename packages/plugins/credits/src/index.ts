import { Lightbulb } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import {
  createCreditsController,
  type CreditsController,
  type CreditsControllerOptions,
  type CreditsTab,
  type CreditsUiState,
  type CreditsUiStoreInstance,
} from "./controller"
import { creditsDictionary, type CreditsDictionary } from "./dictionary"
import { CreditsPage, type CreditsPageInject, type CreditsPageProps } from "./page"

export const CREDITS_PLUGIN_ID = "orahako.credits"

export type {
  CreditsController,
  CreditsControllerOptions,
  CreditsDictionary,
  CreditsPageInject,
  CreditsPageProps,
  CreditsTab,
  CreditsUiState,
  CreditsUiStoreInstance,
}

const creditsManifest: PluginManifest = {
  id: CREDITS_PLUGIN_ID,
  name: "双创学分",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "创新创业学分汇总、申报记录、认定记录与竞赛活动库查询",
  inject: ["ui", "i18n", "provider", "session", "query"],
}

export const creditsPlugin = definePlugin({
  manifest: creditsManifest,
  inject: ["ui", "i18n", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, i18n, provider, session, query } = ctx
    i18n.register(creditsDictionary)

    const controller = createCreditsController({
      provider,
      session,
      query,
    })

    ui.registerPage(
      {
        id: "index",
        route: "credits",
        title: "双创学分",
        titleKey: "credits.title",
        capability: "credits",
        dictionary: creditsDictionary,
        store: controller.uiStore,
        inject: (): CreditsPageInject => ({
          hooks: {
            summary: controller.summarySource,
            batches: controller.batchesSource,
            declarations: controller.declarationsSource,
            records: controller.recordsSource,
            competitions: controller.competitionsSource,
            activities: controller.activitiesSource,
          },
        }),
      },
      CreditsPage
    )

    ui.registerNavigation({
      id: "credits",
      title: "双创学分",
      titleKey: "credits.nav",
      page: "index",
      icon: Lightbulb,
      group: "platform",
      order: 20,
      capability: "credits",
    })

    ctx.effect(() => () => {
      controller.dispose()
    })
  },
})

export default creditsPlugin
