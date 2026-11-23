import { CreditCard } from "lucide-react"
import { hasSlice, requireSlice, type EcardSessionStatus } from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { ecardDictionary, type EcardDictionary } from "./dictionary"
import {
  EcardHeaderActions,
  EcardPage,
  type EcardHeaderActionsInject,
  type EcardPageInject,
  type EcardPageProps,
} from "./page"
import "./slots"
import {
  ECARD_BALANCE_WIDGET_ID,
  EcardSummaryWidget,
  type EcardSummaryWidgetInject,
  type EcardSummaryWidgetProps,
} from "./widget"

export const ECARD_PLUGIN_ID = "orahako.ecard"

export type {
  EcardDictionary,
  EcardHeaderActionsInject,
  EcardPageInject,
  EcardPageProps,
  EcardSummaryWidgetInject,
  EcardSummaryWidgetProps,
}

const ecardManifest: PluginManifest = {
  id: ECARD_PLUGIN_ID,
  name: "一卡通余额",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "校园一卡通余额、卡片状态查询与总览摘要卡片",
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query", "overview"],
}

export const ecardPlugin = definePlugin({
  manifest: ecardManifest,
  inject: ["ui", "slots", "router", "i18n", "provider", "session", "query", "overview"] as const,
  apply(ctx) {
    const { ui, slots, router, i18n, provider, session, query, overview } = ctx
    i18n.register(ecardDictionary)
    let disposed = false

    const ecardSource = query.source<EcardSessionStatus, "ecard">({
      feature: "ecard",
      slice: "ecard",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(session.getSnapshot().username) &&
        Boolean(session.getSnapshot().credential) &&
        hasSlice(provider.getSnapshot().provider, "ecard"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "ecard").fetchBalance(),
    })

    ui.registerPage(
      {
        id: "index",
        route: "ecard",
        title: "一卡通余额",
        titleKey: "ecard.title",
        capability: "ecard",
        dictionary: ecardDictionary,
        inject: (): EcardPageInject => ({
          hooks: {
            session: session.state,
            provider: provider.state,
            ecard: ecardSource,
          },
        }),
      },
      EcardPage
    )

    slots.inject("shell.header.actions", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "ecard-header-actions",
          slot: "shell.header.actions",
          dictionary: ecardDictionary,
          inject: (): EcardHeaderActionsInject => ({
            hooks: {
              location: router.current,
              session: session.state,
              provider: provider.state,
              ecard: ecardSource,
            },
            pluginId: ECARD_PLUGIN_ID,
          }),
        },
        EcardHeaderActions
      )
    )

    ui.registerNavigation({
      id: "ecard",
      title: "一卡通余额",
      titleKey: "ecard.nav",
      page: "index",
      icon: CreditCard,
      group: "fees",
      capability: "ecard",
      order: 10,
    })

    overview.registerWidget(
      {
        id: ECARD_BALANCE_WIDGET_ID,
        title: "一卡通余额",
        titleKey: "widget.title",
        description: "查看一卡通余额，点击进入详情页。",
        descriptionKey: "widget.description",
        icon: CreditCard,
        region: "summary",
        defaultVisible: true,
        order: 10,
        slice: "ecard",
        dictionary: ecardDictionary,
        inject: (): EcardSummaryWidgetInject => ({
          hooks: {
            session: session.state,
            provider: provider.state,
            ecard: ecardSource,
          },
          ecardHref: router.href({ route: "ecard" }),
          openEcard: () => {
            router.push({ route: "ecard" })
          },
        }),
      },
      EcardSummaryWidget
    )

    ctx.effect(() => () => {
      disposed = true
    })
  },
})

export default ecardPlugin
