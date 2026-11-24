import { AirVent } from "lucide-react"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type ObservableSource,
  type PluginManifest,
} from "@orahako/sdk"
import type { SessionService } from "@orahako/academic-sdk"
import type { MeterData, MeterHttp } from "./client"
import { meterDictionary, type MeterDictionary } from "./dictionary"
import {
  MeterHeaderActions,
  MeterPage,
  type MeterHeaderActionsInject,
  type MeterPageInject,
  type MeterPageProps,
} from "./page"
import "./slots"
import {
  createMeterController,
  meterRoomStore,
  type MeterController,
  type MeterQueryFailure,
  type MeterQuerySnapshot,
  type MeterRoomHistoryItem,
  type MeterRoomStoreInstance,
  type MeterRoomStoreState,
  type SessionAccountSnapshot,
} from "./store"
import {
  type DayUse,
  type MeterDevice,
  type MeterOverview,
  type MeterRoom,
  type RechargeRecord,
} from "./types"

export const METER_PLUGIN_ID = "orahako.meter"

export type {
  DayUse,
  MeterController,
  MeterData,
  MeterDevice,
  MeterDictionary,
  MeterHttp,
  MeterHeaderActionsInject,
  MeterOverview,
  MeterPageInject,
  MeterPageProps,
  MeterQueryFailure,
  MeterQuerySnapshot,
  MeterRoom,
  MeterRoomHistoryItem,
  MeterRoomStoreInstance,
  MeterRoomStoreState,
  RechargeRecord,
  SessionAccountSnapshot,
}

const FALLBACK_SESSION_SNAPSHOT: SessionAccountSnapshot = {
  hasHydrated: true,
  username: null,
}

const STATIC_FALLBACK_SESSION_SOURCE: ObservableSource<SessionAccountSnapshot> =
  createObservableSource(FALLBACK_SESSION_SNAPSHOT)

const meterManifest: PluginManifest = {
  id: METER_PLUGIN_ID,
  name: "空调电费",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  providerIndependent: true,
  entry: "index.js",
  description: "宿舍空调智能水电表余额、用电趋势与充值记录查询",
  inject: ["ui", "slots", "router", "i18n", "storage", "http"],
}

export const meterPlugin = definePlugin({
  manifest: meterManifest,
  inject: ["ui", "slots", "router", "i18n", "storage", "http"] as const,
  optionalInject: ["session"] as const,
  apply(ctx) {
    const { ui, slots, router, i18n, storage, http } = ctx
    i18n.register(meterDictionary)

    // Fixed for this plugin generation: a session replacement restarts the
    // plugin, so the controller and page injection never bind to a stale service.
    const session: SessionService | undefined = ctx.session
    const sessionSource: ObservableSource<SessionAccountSnapshot> =
      session?.state ?? STATIC_FALLBACK_SESSION_SOURCE

    const roomStore = meterRoomStore.create(storage)
    const controller = createMeterController({
      roomStore,
      http,
      getSessionAccount: () => session?.getSnapshot() ?? FALLBACK_SESSION_SNAPSHOT,
      subscribeSession: (listener) =>
        session ? session.subscribe(listener) : () => {},
    })

    ui.registerPage(
      {
        id: "index",
        route: "meter",
        title: "空调电费",
        titleKey: "meter.title",
        requiresProvider: false,
        dictionary: meterDictionary,
        store: roomStore,
        inject: (): MeterPageInject => ({
          hooks: {
            storeHydrated: roomStore.hydrated,
            session: sessionSource,
            meter: controller.query,
          },
          queryAccount: (account: string) => controller.queryAccount(account),
          refresh: () => controller.refresh(),
        }),
      },
      MeterPage
    )

    slots.inject("shell.header.actions", (slotCtx) =>
      slotCtx.slots.register(
        {
          id: "meter-header-actions",
          slot: "shell.header.actions",
          dictionary: meterDictionary,
          inject: (): MeterHeaderActionsInject => ({
            hooks: {
              location: router.current,
              meter: controller.query,
            },
            pluginId: METER_PLUGIN_ID,
            refresh: () => controller.refresh(),
          }),
        },
        MeterHeaderActions
      )
    )

    ui.registerNavigation({
      id: "meter",
      title: "空调电费",
      titleKey: "meter.nav",
      page: "index",
      icon: AirVent,
      group: "fees",
      order: 30,
    })

    ctx.effect(() => () => {
      controller.dispose()
      roomStore.dispose()
    })
  },
})

export default meterPlugin
