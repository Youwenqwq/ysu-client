import {
  createObservableSource,
  definePlugin,
  isCapacitor,
  PLUGIN_API_VERSION,
  type PluginConfig,
} from "@orahako/sdk"
import { AnalyticsSettingsToggle, type AnalyticsSettingsToggleInject } from "./components"
import type { PluginAnalyticsService } from "./contract"
import { analyticsDictionary } from "./dictionary"
import { ConfiguredAnalyticsService } from "./service"
import { analyticsConsentStore } from "./store"

export const ANALYTICS_PLUGIN_ID = "orahako.analytics"
export const APP_LAUNCH_DEDUPE_KEY = "app-launch"

export interface AnalyticsPluginConfig extends PluginConfig {
  readonly endpoint?: string
  readonly appVersion: string
}

export const analyticsConfigSchema = {
  type: "object",
  properties: {
    endpoint: { type: "string", minLength: 1 },
    appVersion: { type: "string", minLength: 1 },
  },
  required: ["appVersion"],
  additionalProperties: false,
} as const

export function buildLaunchAnalyticsPayload(appVersion: string): Record<string, unknown> {
  const viewport =
    typeof window !== "undefined" ? `${window.innerWidth ?? 0}x${window.innerHeight ?? 0}` : "0x0"
  const screen =
    typeof window !== "undefined" && window.screen
      ? `${window.screen.width ?? 0}x${window.screen.height ?? 0}`
      : "0x0"
  const ua = typeof navigator !== "undefined" ? (navigator.userAgent ?? "") : ""

  return {
    version: appVersion,
    viewport,
    screen,
    platform: isCapacitor() ? "android" : "web",
    ua,
  }
}

export const analyticsPlugin = definePlugin({
  manifest: {
    id: ANALYTICS_PLUGIN_ID,
    name: "匿名统计",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    provides: ["analytics"],
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "i18n", "storage"],
  },
  inject: ["slots", "i18n", "storage"] as const,
  configSchema: analyticsConfigSchema,
  apply(ctx, config: AnalyticsPluginConfig) {
    const tracker = new ConfiguredAnalyticsService({
      endpoint: config.endpoint,
      storage: ctx.storage.local,
    })
    const consentStore = analyticsConsentStore.create(ctx.storage)
    const consentSource = createObservableSource<boolean>(consentStore.source.getSnapshot().consent)

    let disposed = false
    let startupHandled = false

    const triggerLaunchTrack = () => {
      if (disposed) return
      void tracker
        .track(buildLaunchAnalyticsPayload(config.appVersion), {
          enabled: true,
          oncePerDay: true,
          dedupeKey: APP_LAUNCH_DEDUPE_KEY,
        })
        .catch(() => {
          // Telemetry errors must never disrupt UI startup.
        })
    }

    const setConsent = (enabled: boolean) => {
      if (disposed) return
      consentStore.actions.setConsent(enabled)
      consentSource.set(enabled)
      if (enabled) {
        triggerLaunchTrack()
      }
    }

    const unsubscribeConsent = consentStore.source.subscribe(() => {
      if (disposed) return
      consentSource.set(consentStore.source.getSnapshot().consent)
    })

    const handleHydratedStartup = () => {
      if (disposed || startupHandled || !consentStore.hydrated.getSnapshot()) return
      startupHandled = true

      const { consent, decided } = consentStore.source.getSnapshot()
      consentSource.set(consent)
      if (decided && consent) {
        triggerLaunchTrack()
      }
    }

    const unsubscribeHydrated = consentStore.hydrated.subscribe(handleHydratedStartup)
    handleHydratedStartup()

    const service: PluginAnalyticsService = {
      endpoint: tracker.endpoint,
      consent: {
        getSnapshot: consentSource.getSnapshot,
        subscribe: consentSource.subscribe,
      },
      setConsent,
      track: (payload, options) => tracker.track(payload, options),
    }

    ctx.effect(() => () => {
      disposed = true
      unsubscribeHydrated()
      unsubscribeConsent()
      tracker.dispose()
      consentStore.dispose()
    })

    ctx.i18n.register(analyticsDictionary)
    ctx.set("analytics", service)

    ctx.slots.inject("settings.general", () =>
      ctx.slots.register(
        {
          id: "analytics-consent-toggle",
          slot: "settings.general",
          dictionary: analyticsDictionary,
          store: consentStore,
          inject: (): AnalyticsSettingsToggleInject => ({
            onConsentChange: setConsent,
          }),
        },
        AnalyticsSettingsToggle
      )
    )
  },
})
