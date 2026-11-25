import { CapacitorUpdater } from "@capgo/capacitor-updater"
import { toast } from "sonner"
import { definePlugin, PLUGIN_API_VERSION } from "@orahako/sdk"
import type { UpdateInfo, UpdateMirror } from "./contract"
import { UpdaterAboutSection, type UpdaterAboutSectionProps } from "./controls"
import { updaterDictionary, type UpdaterDictionary } from "./dictionary"
import { UpdaterOverlay, type UpdaterOverlayProps } from "./overlay"
import {
  createPwaController,
  PWA_UPDATE_CHECK_INTERVAL_MS,
  type BeforeInstallPromptEvent,
  type PwaController,
  type PwaControllerOptions,
  type PwaInstallState,
} from "./pwa"
import {
  ConfiguredUpdateService,
  DEFAULT_MIRRORS,
  EMPTY_UPDATE,
  isNewer,
  type ConfiguredUpdateOptions,
} from "./service"
import {
  isUpdateChannel,
  updaterPreferencesStore,
  updaterRuntimeStore,
  type UpdaterPreferencesState,
  type UpdaterPreferencesStore,
  type UpdaterRuntimeState,
  type UpdaterRuntimeStore,
} from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
    "about.extra": { kind: "list"; owner: Record<string, never> }
  }
}

export {
  ConfiguredUpdateService,
  createPwaController,
  DEFAULT_MIRRORS,
  EMPTY_UPDATE,
  isNewer,
  isUpdateChannel,
  PWA_UPDATE_CHECK_INTERVAL_MS,
  UpdaterAboutSection,
  updaterDictionary,
  UpdaterOverlay,
  updaterPreferencesStore,
  updaterRuntimeStore,
  type BeforeInstallPromptEvent,
  type ConfiguredUpdateOptions,
  type PwaController,
  type PwaControllerOptions,
  type PwaInstallState,
  type UpdaterAboutSectionProps,
  type UpdaterDictionary,
  type UpdaterOverlayProps,
  type UpdaterPreferencesState,
  type UpdaterPreferencesStore,
  type UpdaterRuntimeState,
  type UpdaterRuntimeStore,
}

export type {
  PluginUpdateService,
  UpdateChannel,
  UpdateCheckOptions,
  UpdateInfo,
  UpdateManifest,
  UpdateManifestEntry,
  UpdateMirror,
} from "./contract"

export type UpdaterPluginConfig = {
  readonly releaseBaseUrl?: string
  readonly currentVersion: string
  readonly mirrors?: readonly UpdateMirror[]
  readonly mirrorableOrigins?: readonly string[]
  readonly basePath?: string
}

export const updaterPlugin = definePlugin<
  readonly ["slots", "i18n", "storage", "native"],
  UpdaterPluginConfig
>({
  manifest: {
    id: "orahako.updater",
    name: "应用更新",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    provides: ["updater"],
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "i18n", "storage", "native"],
    description: "Android APK/OTA 更新、Web PWA Service Worker 更新与连接镜像控制",
  },
  inject: ["slots", "i18n", "storage", "native"] as const,
  configSchema: {
    type: "object",
    required: ["currentVersion"],
    properties: {
      releaseBaseUrl: { type: "string", minLength: 1 },
      currentVersion: { type: "string", minLength: 1 },
      mirrors: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "value"],
          properties: {
            label: { type: "string", minLength: 1 },
            value: { type: "string" },
          },
          additionalProperties: false,
        },
      },
      mirrorableOrigins: {
        type: "array",
        items: { type: "string", minLength: 1 },
      },
      basePath: { type: "string" },
    },
    additionalProperties: false,
  },
  apply(ctx, config: UpdaterPluginConfig) {
    const preferencesStore = updaterPreferencesStore.create(ctx.storage)
    const runtimeStore = updaterRuntimeStore.create()
    const translator = ctx.i18n.translator(updaterDictionary)

    ctx.i18n.register({
      zh: { update: updaterDictionary.zh },
      en: { update: updaterDictionary.en },
    })

    const service = new ConfiguredUpdateService({
      ...(config.releaseBaseUrl !== undefined ? { releaseBaseUrl: config.releaseBaseUrl } : {}),
      currentVersion: config.currentVersion,
      ...(config.mirrors !== undefined ? { mirrors: config.mirrors } : {}),
      ...(config.mirrorableOrigins !== undefined
        ? { mirrorableOrigins: config.mirrorableOrigins }
        : {}),
      storage: ctx.storage.local,
      native: ctx.native,
    })
    ctx.set("updater", service)

    const pwa = createPwaController({
      storage: ctx.storage.local,
      isNative: () => ctx.native.isNative,
      ...(config.basePath !== undefined ? { basePath: config.basePath } : {}),
      onUpdateAvailable: (available) => runtimeStore.actions.setPwaUpdateAvailable(available),
      onOfflineReady: () => toast.success(translator("offlineReady")),
    })
    pwa.start()

    let disposed = false
    ctx.effect(() => () => {
      disposed = true
      pwa.dispose()
      service.dispose()
      preferencesStore.dispose()
      runtimeStore.dispose()
    })

    // Signal CapacitorUpdater immediately on native startup so OTA bundles commit before appReadyTimeout.
    if (ctx.native.isNative) {
      CapacitorUpdater.notifyAppReady().catch(() => {})

      if (config.releaseBaseUrl) {
        const triggerAutoCheck = () => {
          if (disposed || !preferencesStore.hydrated.getSnapshot()) return false
          const prefs = preferencesStore.source.getSnapshot()
          void service
            .checkForUpdate({
              automatic: true,
              mirror: prefs.mirror,
              channel: prefs.channel,
            })
            .then((info) => {
              if (disposed) return
              if (info.available || info.apkUpdateAvailable) {
                runtimeStore.actions.presentUpdate(info)
              }
            })
            .catch(() => {})
          return true
        }

        if (!triggerAutoCheck()) {
          const unsubHydrated = preferencesStore.hydrated.subscribe(() => {
            if (triggerAutoCheck()) {
              unsubHydrated()
            }
          })
          ctx.effect(() => unsubHydrated)
        }
      }
    }

    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          id: "updater-overlay",
          slot: "shell.overlay",
          order: 30,
          dictionary: updaterDictionary,
          store: runtimeStore,
          inject: () => ({
            updater: service,
            applyWebUpdate: () => pwa.applyWebUpdate(),
            dismissWebUpdate: () => pwa.dismissWebUpdate(),
          }),
        },
        UpdaterOverlay
      )
    )

    ctx.slots.inject("about.extra", () =>
      ctx.slots.register(
        {
          id: "updater-about",
          slot: "about.extra",
          order: 20,
          dictionary: updaterDictionary,
          store: preferencesStore,
          inject: () => ({
            updater: service,
            currentVersion: config.currentVersion,
            isNative: () => ctx.native.isNative,
            onPresentUpdate: (info: UpdateInfo) => runtimeStore.actions.presentUpdate(info),
            promptPwaInstall: () => pwa.promptInstall(),
            hooks: {
              installState: pwa.installState,
            },
          }),
        },
        UpdaterAboutSection
      )
    )
  },
})

export default updaterPlugin
