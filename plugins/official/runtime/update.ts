import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type PluginConfig,
  type PluginContext,
  type UpdateMirror,
} from "@orahako/plugin-sdk"
import { ConfiguredUpdateService } from "./update/service"

export interface UpdateRuntimeConfig extends PluginConfig {
  /** Base URL hosting the release manifest and bundle assets. */
  releaseBaseUrl: string
  /** Installed application version, supplied by the active composition. */
  currentVersion: string
  /** Mirror presets offered by the composition; omitted means direct only. */
  mirrors?: readonly UpdateMirror[]
  /** Asset origins that a mirror prefix may rewrite. */
  mirrorableOrigins?: readonly string[]
  /** Release manifest filename, relative to the base URL. */
  versionManifest?: string
  /** Web bundle filename, relative to the base URL. */
  bundleAsset?: string
  /** Automatic check cooldown in minutes. */
  checkCooldownMinutes?: number
  /** localStorage key used to persist the automatic check time. */
  checkCooldownStorageKey?: string
  /** localStorage key marked after a bundle download for OTA cleanup. */
  otaCleanupStorageKey?: string
}

const definition = definePlugin(
  (ctx: PluginContext, config: UpdateRuntimeConfig) => {
    const service = new ConfiguredUpdateService({
      releaseBaseUrl: config.releaseBaseUrl,
      currentVersion: config.currentVersion,
      mirrors: config.mirrors,
      mirrorableOrigins: config.mirrorableOrigins,
      versionManifestName: config.versionManifest,
      bundleAssetName: config.bundleAsset,
      checkCooldownMs:
        config.checkCooldownMinutes === undefined
          ? undefined
          : config.checkCooldownMinutes * 60_000,
      checkCooldownStorageKey: config.checkCooldownStorageKey,
      otaCleanupStorageKey: config.otaCleanupStorageKey,
    })
    ctx.set("updater", service)
    ctx.on("dispose", () => service.dispose())
  }
)

export const updateRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.update",
    name: "Release update runtime",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description:
      "Web-bundle OTA and APK download mechanisms driven by a configured release base URL.",
    provides: ["updater"],
    configSchema: {
      type: "object",
      properties: {
        releaseBaseUrl: { type: "string", minLength: 1 },
        currentVersion: { type: "string", minLength: 1 },
        mirrors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", minLength: 1 },
              value: { type: "string" },
            },
            required: ["label", "value"],
            additionalProperties: false,
          },
        },
        mirrorableOrigins: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
        versionManifest: { type: "string", minLength: 1 },
        bundleAsset: { type: "string", minLength: 1 },
        checkCooldownMinutes: { type: "number", minimum: 0 },
        checkCooldownStorageKey: { type: "string", minLength: 1 },
        otaCleanupStorageKey: { type: "string", minLength: 1 },
      },
      required: ["releaseBaseUrl", "currentVersion"],
      additionalProperties: false,
    },
  },
  definition,
}
