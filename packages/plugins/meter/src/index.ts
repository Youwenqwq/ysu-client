import { AirVent } from "lucide-react"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type Context,
  type ObservableSource,
  type PluginManifest,
} from "@orahako/sdk"
import type { MeterData, MeterHttp } from "./client"
import { meterDictionary, type MeterDictionary } from "./dictionary"
import { MeterPage, type MeterPageInject, type MeterPageProps } from "./page"
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
  isRecord,
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

interface HostSessionLike {
  readonly state: ObservableSource<SessionAccountSnapshot>
  getSnapshot(): SessionAccountSnapshot
}

const FALLBACK_SESSION_SNAPSHOT: SessionAccountSnapshot = {
  hasHydrated: true,
  username: null,
}

const STATIC_FALLBACK_SESSION_SOURCE: ObservableSource<SessionAccountSnapshot> =
  createObservableSource(FALLBACK_SESSION_SNAPSHOT)

function isObservableSource(value: unknown): value is ObservableSource<SessionAccountSnapshot> {
  return (
    isRecord(value) &&
    typeof value.getSnapshot === "function" &&
    typeof value.subscribe === "function"
  )
}

function isHostSessionLike(value: unknown): value is HostSessionLike {
  return (
    isRecord(value) && typeof value.getSnapshot === "function" && isObservableSource(value.state)
  )
}

const meterManifest: PluginManifest = {
  id: METER_PLUGIN_ID,
  name: "空调电费",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  providerIndependent: true,
  entry: "index.js",
  description: "宿舍空调智能水电表余额、用电趋势与充值记录查询",
  inject: ["ui", "i18n", "storage", "http"],
}

export const meterPlugin = definePlugin({
  manifest: meterManifest,
  inject: ["ui", "i18n", "storage", "http"] as const,
  apply(ctx) {
    const { ui, i18n, storage, http } = ctx
    i18n.register(meterDictionary)

    const roomStore = meterRoomStore.create(storage)
    let attachedSession: HostSessionLike | null = null
    const sessionListeners = new Set<() => void>()
    let detachHostSession: (() => void) | undefined

    const bindHostSession = (fullCtx: Context): HostSessionLike | null => {
      const candidate: unknown = fullCtx.root.get("session")
      if (!isHostSessionLike(candidate)) {
        return null
      }
      if (attachedSession !== candidate) {
        detachHostSession?.()
        attachedSession = candidate
        detachHostSession = candidate.state.subscribe(() => {
          for (const listener of Array.from(sessionListeners)) {
            listener()
          }
        })
        for (const listener of Array.from(sessionListeners)) {
          listener()
        }
      }
      return candidate
    }

    const controller = createMeterController({
      roomStore,
      http,
      getSessionAccount: () =>
        attachedSession ? attachedSession.getSnapshot() : FALLBACK_SESSION_SNAPSHOT,
      subscribeSession: (listener) => {
        sessionListeners.add(listener)
        return () => {
          sessionListeners.delete(listener)
        }
      },
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
        inject: (fullCtx: Context): MeterPageInject => {
          const hostSession = bindHostSession(fullCtx)
          return {
            hooks: {
              storeHydrated: roomStore.hydrated,
              session: hostSession ? hostSession.state : STATIC_FALLBACK_SESSION_SOURCE,
              meter: controller.query,
            },
            queryAccount: (account: string) => controller.queryAccount(account),
            refresh: () => controller.refresh(),
          }
        },
      },
      MeterPage
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
      detachHostSession?.()
      detachHostSession = undefined
      attachedSession = null
      sessionListeners.clear()
      controller.dispose()
      roomStore.dispose()
    })
  },
})

export default meterPlugin
