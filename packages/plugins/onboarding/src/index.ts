import {
  createObservableSource,
  definePlugin,
  loadPluginMarket,
  PLUGIN_API_VERSION,
  type MarketplaceIndex,
  type PluginConfig,
  type PluginPackageRuntime,
} from "@orahako/sdk"
import "./slots"
import {
  onboardingDictionary,
  onboardingStore,
  type OnboardingDictionary,
  type OnboardingState,
  type OnboardingStoreInstance,
} from "./store"
import { OnboardingWizard, type OnboardingSchoolChoice } from "./wizard"

export const ONBOARDING_PLUGIN_ID = "orahako.onboarding"
const DEFAULT_MARKET_URL = "https://ysu.welain.com/updates/plugins.json"

export interface OnboardingPluginConfig extends PluginConfig {
  readonly schools?: readonly OnboardingSchoolChoice[]
  readonly marketUrl?: string
}

export {
  onboardingDictionary,
  onboardingStore,
  OnboardingWizard,
  type OnboardingDictionary,
  type OnboardingSchoolChoice,
  type OnboardingState,
  type OnboardingStoreInstance,
}

function resolveRuntimeMarketUrl(
  packageRuntime: PluginPackageRuntime,
  configuredUrl?: string
): string {
  if ("marketUrl" in packageRuntime && typeof packageRuntime.marketUrl === "function") {
    const runtimeUrl: unknown = packageRuntime.marketUrl()
    if (typeof runtimeUrl === "string" && runtimeUrl.trim().length > 0) {
      return runtimeUrl
    }
  }
  return configuredUrl ?? DEFAULT_MARKET_URL
}

function resolveBundlePluginIds(
  school: OnboardingSchoolChoice,
  index: MarketplaceIndex
): readonly string[] | undefined {
  const bundles = index.bundles ?? []
  if (school.bundleId) {
    const matchedById = bundles.find((bundle) => bundle.id === school.bundleId)
    if (matchedById && matchedById.pluginIds.length > 0) {
      return matchedById.pluginIds
    }
  }
  const matchedBySchool = bundles.find((bundle) => bundle.schoolId === school.id)
  if (matchedBySchool && matchedBySchool.pluginIds.length > 0) {
    return matchedBySchool.pluginIds
  }
  if (school.bundleId && index.plugins.some((plugin) => plugin.id === school.bundleId)) {
    return [school.bundleId]
  }
  return undefined
}

export const onboardingPlugin = definePlugin({
  manifest: {
    id: ONBOARDING_PLUGIN_ID,
    name: "初始化向导",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    providerIndependent: true,
    entry: "index.js",
    description: "首次启动学校选择、市场推荐组合安装与系统权限引导",
    inject: [
      "slots",
      "i18n",
      "storage",
      "providers",
      "provider",
      "session",
      "native",
      "packageRuntime",
    ],
    configSchema: {
      type: "object",
      properties: {
        marketUrl: { type: "string", minLength: 1 },
        schools: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
              nameEn: { type: "string", minLength: 1 },
              bundleId: { type: "string", minLength: 1 },
              builtin: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  inject: [
    "slots",
    "i18n",
    "storage",
    "providers",
    "provider",
    "session",
    "native",
    "packageRuntime",
  ] as const,
  apply(ctx, config: OnboardingPluginConfig = {}) {
    const { slots, storage, providers, provider, session, native, packageRuntime } = ctx
    let disposed = false
    const store = onboardingStore.create(storage)
    const providersRevision = createObservableSource(0)
    const detachProviders = providers.subscribe(() => {
      if (disposed) return
      providersRevision.set(providersRevision.getSnapshot() + 1)
    })

    const resolveSchools = (): readonly OnboardingSchoolChoice[] => {
      if (config.schools && config.schools.length > 0) {
        return config.schools
      }
      return providers.listProviders().map((id) => ({
        id,
        name: id,
        builtin: true,
      }))
    }

    const activateSchoolChoice = async (school: OnboardingSchoolChoice): Promise<void> => {
      const needsBundleInstall =
        !providers.hasProvider(school.id) || (Boolean(school.bundleId) && !school.builtin)

      if (needsBundleInstall) {
        const { index } = await loadPluginMarket(
          resolveRuntimeMarketUrl(packageRuntime, config.marketUrl)
        )
        const bundlePluginIds = resolveBundlePluginIds(school, index)
        if (bundlePluginIds && bundlePluginIds.length > 0) {
          await packageRuntime.applyPluginBundle(bundlePluginIds, index)
        }
      }

      if (!providers.hasProvider(school.id)) {
        throw new Error(`School provider is not registered: ${school.id}`)
      }

      provider.selectSchool(school.id)
      void provider.initialize().catch(() => {})
    }

    slots.inject("shell.overlay", () =>
      slots.register(
        {
          id: "onboarding",
          slot: "shell.overlay",
          order: -100,
          dictionary: onboardingDictionary,
          store,
          inject: () => ({
            hooks: {
              storeHydrated: store.hydrated,
              session: session.state,
              providersRevision,
            },
            schools: resolveSchools(),
            isNative: () => native.isNative,
            hasProvider: (schoolId: string) => providers.hasProvider(schoolId),
            activateSchoolChoice,
            requestNotificationPermission: () => native.requestNotificationPermission(),
            requestExactAlarmPermission: () => native.requestExactAlarmPermission(),
            requestBatteryOptimizationExemption: () => native.requestBatteryOptimizationExemption(),
          }),
        },
        OnboardingWizard
      )
    )

    ctx.effect(() => () => {
      disposed = true
      detachProviders()
      store.dispose()
    })
  },
})

export default onboardingPlugin
