import type { CompositionPlugin, CompositionSource, PluginConfig } from "@orahako/plugin-sdk"
import { OFFICIAL_PLUGINS } from "./registry"
import { registryRuntimePlugins } from "./runtime/registries"
import { storageRuntimePlugin } from "./runtime/storage"
import { createHttpRuntimePlugin, nativeRuntimePlugin } from "./runtime/platform"
import { assetsRuntimePlugin, installerRuntimePlugin } from "./runtime/packages"
import { providerRegistryRuntimePlugin } from "./runtime/providers"
import { createSessionRuntimePlugin } from "./runtime/session"
import { navigationRuntimePlugin } from "./runtime/navigation"
import { queryRuntimePlugin, officialQueryPolicies } from "./runtime/query"
import { providerRuntimePlugin } from "./runtime/provider"
import { providerSupportRuntimePlugin } from "./runtime/provider-support"
import { analyticsRuntimePlugin } from "./runtime/analytics"
import { announcementRuntimePlugin } from "./runtime/announcement"
import { updateRuntimePlugin } from "./runtime/update"
import { STORAGE_KEYS } from "./runtime/storage/keys"
import {
  officialAnalyticsEndpoint,
  officialAnnouncementUrl,
  officialAppBuild,
  officialAppIdentity,
  officialAppVersion,
  officialMarketUrl,
  officialMirrorableOrigins,
  officialReleaseBaseUrl,
  officialSchoolChoices,
  officialUpdateMirrors,
} from "./app-config"
import { mfaRuntimePlugin } from "./shell/mfa-service"
import { useActivationStore } from "./shell/stores/activation"

/**
 * Web activation credentials belong to the application composition. The HTTP
 * and session runtimes only receive this capability; they never read the shell
 * store directly.
 */
const activationTokenSource = {
  getToken: () => useActivationStore.getState().token,
  clearToken: () => useActivationStore.getState().clearToken(),
}

const httpRuntimePlugin = createHttpRuntimePlugin(activationTokenSource)
const sessionRuntimePlugin = createSessionRuntimePlugin(activationTokenSource)

const runtimePlugins: readonly CompositionPlugin[] = [
  ...registryRuntimePlugins,
  storageRuntimePlugin,
  httpRuntimePlugin,
  nativeRuntimePlugin,
  installerRuntimePlugin,
  assetsRuntimePlugin,
  providerRegistryRuntimePlugin,
  sessionRuntimePlugin,
  navigationRuntimePlugin,
  queryRuntimePlugin,
  providerRuntimePlugin,
  providerSupportRuntimePlugin,
  analyticsRuntimePlugin,
  announcementRuntimePlugin,
  updateRuntimePlugin,
  mfaRuntimePlugin,
]

const plugins = [...runtimePlugins, ...OFFICIAL_PLUGINS]

const runtimeConfig: Record<string, PluginConfig> = {
  [installerRuntimePlugin.manifest.id]: {
    marketUrl: officialMarketUrl,
    appVersion: officialAppVersion,
  },
  [sessionRuntimePlugin.manifest.id]: { defaultSchoolId: "ysu" },
  [providerRuntimePlugin.manifest.id]: { defaultSchoolId: "ysu" },
  [navigationRuntimePlugin.manifest.id]: { fallbackHref: "/dashboard/me" },
  [queryRuntimePlugin.manifest.id]: { policies: officialQueryPolicies },
  [analyticsRuntimePlugin.manifest.id]: { endpoint: officialAnalyticsEndpoint },
  [announcementRuntimePlugin.manifest.id]: {
    endpoint: officialAnnouncementUrl,
    dismissedStorageKey: STORAGE_KEYS.lastDismissedAnnouncementId,
  },
  [updateRuntimePlugin.manifest.id]: {
    releaseBaseUrl: officialReleaseBaseUrl,
    currentVersion: officialAppVersion,
    mirrors: officialUpdateMirrors,
    mirrorableOrigins: officialMirrorableOrigins,
    checkCooldownStorageKey: STORAGE_KEYS.lastUpdateCheck,
    otaCleanupStorageKey: STORAGE_KEYS.otaCleanup,
  },
  "orahako.onboarding": {
    schools: officialSchoolChoices,
  },
}

export const officialCompositionSource: CompositionSource = {
  appVersion: officialAppVersion,
  appBuild: officialAppBuild,
  composition: {
    id: "orahako.official",
    version: 1,
    identity: officialAppIdentity,
    defaults: {
      shell: "orahako.shell:default",
      schoolId: "ysu",
      landing: "overview",
    },
    market: { indexUrl: officialMarketUrl },
    nativeCapabilities: [
      "native.files@1",
      "native.webview@1",
      "notifications.core@1",
      "academic.polling@1",
      "reminders.classes@1",
      "widgets.generic@1",
      "widgets.schedule@1",
      "widgets.exam@1",
      "native.geolocation@1",
    ],
    plugins: plugins.map((plugin) => ({
      id: plugin.manifest.id,
      config: runtimeConfig[plugin.manifest.id],
      protected: plugin.manifest.kind === "runtime" || plugin.manifest.required,
    })),
  },
  plugins,
}
