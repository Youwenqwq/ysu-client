import { Wallet } from "lucide-react"
import { toast } from "sonner"
import {
  getSlice,
  hasSlice,
  requireSlice,
  type EpayRecord,
  type EpayRecordStatus,
  type EpaySessionStatus,
} from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import {
  runEpayAutoCheck,
  shouldTriggerEpayCheckOnSession,
  type EpayAutoCheckOptions,
  type EpayCheckResult,
  type EpaySessionTriggerState,
} from "./auto-check"
import { epayDictionary, type EpayDictionary } from "./dictionary"
import {
  EpayHeaderActions,
  EpayPage,
  type EpayHeaderActionsInject,
  type EpayPageInject,
  type EpayPageProps,
} from "./page"
import {
  EpayNotificationSettings,
  type EpayNotificationSettingsInject,
  type EpayNotificationSettingsProps,
} from "./settings"
import "./slots"
import {
  epaySettingsStore,
  type EpayAccountSetting,
  type EpaySettingsState,
  type EpaySettingsStoreInstance,
} from "./store"

export const EPAY_PLUGIN_ID = "orahako.epay"

export type {
  EpayAccountSetting,
  EpayAutoCheckOptions,
  EpayCheckResult,
  EpayDictionary,
  EpayHeaderActionsInject,
  EpayNotificationSettingsInject,
  EpayNotificationSettingsProps,
  EpayPageInject,
  EpayPageProps,
  EpaySettingsState,
  EpaySettingsStoreInstance,
}

const epayManifest: PluginManifest = {
  id: EPAY_PLUGIN_ID,
  name: "缴费查询",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  description: "学费与校园缴费状态查询及未缴费用自动提醒",
  inject: ["ui", "slots", "router", "i18n", "storage", "provider", "session", "query"],
}

export const epayPlugin = definePlugin({
  manifest: epayManifest,
  inject: ["ui", "slots", "router", "i18n", "storage", "provider", "session", "query"] as const,
  apply(ctx) {
    const { ui, slots, router, i18n, storage, provider, session, query } = ctx
    i18n.register(epayDictionary)
    const translate = i18n.translator(epayDictionary)

    let disposed = false
    const settingsStore = epaySettingsStore.create(storage)
    const inFlight = new Map<string, string | null>()

    const epaySource = query.source<EpaySessionStatus, "epay">({
      feature: "epay",
      slice: "epay",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        Boolean(session.getSnapshot().username) &&
        Boolean(session.getSnapshot().credential) &&
        hasSlice(provider.getSnapshot().provider, "epay"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "epay").fetchPayments(),
    })

    const getRecordStatus = (record: EpayRecord): EpayRecordStatus => {
      const epaySlice = getSlice(provider.getSnapshot().provider, "epay")
      return epaySlice ? epaySlice.recordStatus(record) : "unknown"
    }

    ui.registerPage(
      {
        id: "index",
        route: "epay",
        title: "缴费查询",
        titleKey: "epay.title",
        capability: "epay",
        dictionary: epayDictionary,
        inject: (): EpayPageInject => ({
          hooks: {
            session: session.state,
            provider: provider.state,
            epay: epaySource,
          },
          getRecordStatus,
        }),
      },
      EpayPage
    )

    ui.registerNavigation({
      id: "epay",
      title: "缴费查询",
      titleKey: "epay.nav",
      page: "index",
      icon: Wallet,
      group: "fees",
      capability: "epay",
      order: 20,
    })

    slots.inject("shell.header.actions", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "epay-header-actions",
          slot: "shell.header.actions",
          dictionary: epayDictionary,
          inject: (): EpayHeaderActionsInject => ({
            hooks: {
              location: router.current,
              session: session.state,
              provider: provider.state,
              epay: epaySource,
            },
            pluginId: EPAY_PLUGIN_ID,
          }),
        },
        EpayHeaderActions
      )
    )

    slots.inject("settings.notifications.appReminders", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "reminder-settings",
          slot: "settings.notifications.appReminders",
          order: 20,
          dictionary: epayDictionary,
          store: settingsStore,
          inject: (): EpayNotificationSettingsInject => ({
            hooks: {
              provider: provider.state,
            },
          }),
        },
        EpayNotificationSettings
      )
    )

    const checkUnpaid = async (): Promise<void> => {
      const result = await runEpayAutoCheck({
        session,
        provider,
        store: settingsStore,
        inFlight,
        isDisposed: () => disposed,
      })
      if (disposed || !result?.hasUnpaid) return
      toast.warning(
        translate("epay.unpaidNotify", {
          count: result.count,
          total: result.total.toFixed(2),
        })
      )
    }

    const readSessionTrigger = (): EpaySessionTriggerState => {
      const current = session.getSnapshot()
      return {
        hasHydrated: current.hasHydrated,
        isAuthenticated: current.isAuthenticated,
        username: current.username,
        credential: current.credential,
      }
    }

    let previousSessionTrigger = readSessionTrigger()

    const unsubSession = session.state.subscribe(() => {
      if (disposed) return
      const current = readSessionTrigger()
      const shouldCheck = shouldTriggerEpayCheckOnSession(previousSessionTrigger, current)
      previousSessionTrigger = current
      if (!shouldCheck) return
      void checkUnpaid()
    })

    ctx.on("provider/ready", () => {
      void checkUnpaid()
    })

    if (provider.getSnapshot().status === "ready") {
      void checkUnpaid()
    }

    ctx.effect(() => () => {
      disposed = true
      unsubSession()
      inFlight.clear()
      settingsStore.dispose()
    })
  },
})

export default epayPlugin
