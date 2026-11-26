import type { PluginAnalyticsService } from "@orahako/ui-analytics"
import {
  createObservableSource,
  definePlugin,
  loadPluginMarket,
  PLUGIN_API_VERSION,
  type MarketplacePlugin,
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
import {
  ONBOARDING_COMPLETING_EVENT,
  OnboardingWizard,
  type OnboardingSchoolChoice,
} from "./wizard"

export const ONBOARDING_PLUGIN_ID = "orahako.onboarding"
const DEFAULT_MARKET_URL =
  "https://raw.githubusercontent.com/Youwenqwq/orahako-plugin-registry/main/dist/plugins.json"
const PROVIDER_CATEGORY = "provider"
const PROVIDER_PLUGIN_SUFFIX = ".provider"

export interface OnboardingPluginConfig extends PluginConfig {
  readonly schools?: readonly OnboardingSchoolChoice[]
  readonly marketUrl?: string
}

export {
  ONBOARDING_COMPLETING_EVENT,
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

function resolveProviderSchoolId(plugin: MarketplacePlugin): string | undefined {
  if (!plugin.categories.includes(PROVIDER_CATEGORY)) return undefined
  if (!plugin.id.endsWith(PROVIDER_PLUGIN_SUFFIX)) return undefined
  const schoolId = plugin.id.slice(0, -PROVIDER_PLUGIN_SUFFIX.length)
  return schoolId.length > 0 ? schoolId : undefined
}

function mergeDiscoveredSchools(
  base: readonly OnboardingSchoolChoice[],
  plugins: readonly MarketplacePlugin[]
): readonly OnboardingSchoolChoice[] {
  const known = new Set(base.map((school) => school.id))
  const discovered: OnboardingSchoolChoice[] = []
  for (const plugin of plugins) {
    const schoolId = resolveProviderSchoolId(plugin)
    if (!schoolId || known.has(schoolId)) continue
    known.add(schoolId)
    discovered.push({
      id: schoolId,
      name: plugin.name,
      bundleId: plugin.id,
    })
  }
  return discovered.length > 0 ? [...base, ...discovered] : base
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
    description: "首次启动学校选择、市场 Provider 发现与安装、系统权限引导",
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
  optionalInject: ["analytics"] as const,
  apply(ctx, config: OnboardingPluginConfig = {}) {
    const analytics: PluginAnalyticsService | undefined = ctx.analytics
    const { slots, i18n, storage, providers, provider, session, native, packageRuntime } = ctx
    i18n.register(onboardingDictionary)
    let disposed = false
    let discoveryGeneration = 0
    const store = onboardingStore.create(storage)

    const configuredSchools: readonly OnboardingSchoolChoice[] =
      config.schools && config.schools.length > 0
        ? config.schools
        : providers.listProviders().map((id) => ({
            id,
            name: id,
            builtin: true,
          }))

    const schools = createObservableSource<readonly OnboardingSchoolChoice[]>(configuredSchools)
    const schoolsLoading = createObservableSource(false)
    const schoolsError = createObservableSource<string | null>(null)

    const discoverSchools = async (): Promise<void> => {
      if (disposed) return
      const generation = ++discoveryGeneration
      schoolsLoading.set(true)
      schoolsError.set(null)
      try {
        const { index } = await loadPluginMarket(
          resolveRuntimeMarketUrl(packageRuntime, config.marketUrl)
        )
        if (disposed || generation !== discoveryGeneration) return
        schools.set(mergeDiscoveredSchools(configuredSchools, index.plugins))
      } catch (error) {
        if (disposed || generation !== discoveryGeneration) return
        schoolsError.set(error instanceof Error ? error.message : String(error))
      } finally {
        if (!disposed && generation === discoveryGeneration) {
          schoolsLoading.set(false)
        }
      }
    }

    const activateSchoolChoice = async (school: OnboardingSchoolChoice): Promise<void> => {
      const builtinReady = school.builtin === true && providers.hasProvider(school.id)

      if (!builtinReady) {
        const pluginId = school.bundleId ?? `${school.id}${PROVIDER_PLUGIN_SUFFIX}`
        const marketUrl = resolveRuntimeMarketUrl(packageRuntime, config.marketUrl)
        const { index } = await loadPluginMarket(marketUrl)
        if (!index.plugins.some((plugin) => plugin.id === pluginId)) {
          throw new Error(`School provider plugin is unavailable: ${pluginId}`)
        }
        await packageRuntime.applyPluginBundle([pluginId], index, marketUrl)
      }

      if (!providers.hasProvider(school.id)) {
        throw new Error(`School provider is not registered: ${school.id}`)
      }

      provider.selectSchool(school.id)
      void provider.initialize().catch(() => {})
    }

    const checkNativePermission = async (
      method: "checkPermissions" | "checkExactAlarmPermission" | "checkBatteryOptimization",
      field: "granted" | "ignored"
    ): Promise<boolean> => {
      if (!native.isNative) return false
      if (!native.capabilities.has("notifications.core@1")) return false
      try {
        const result = await native.capabilities.invoke<Record<string, unknown>>(
          "notifications.core@1",
          method
        )
        return result?.[field] === true
      } catch {
        return false
      }
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
              schools,
              schoolsLoading,
              schoolsError,
            },
            retrySchoolDiscovery: () => {
              void discoverSchools()
            },
            hasAnalytics: () => Boolean(analytics?.endpoint),
            setAnalyticsConsent: (enabled: boolean) => {
              analytics?.setConsent(enabled)
            },
            isNative: () => native.isNative,
            hasProvider: (schoolId: string) => providers.hasProvider(schoolId),
            activateSchoolChoice,
            checkNotificationPermission: () => checkNativePermission("checkPermissions", "granted"),
            checkExactAlarmPermission: () =>
              checkNativePermission("checkExactAlarmPermission", "granted"),
            checkBatteryOptimization: () =>
              checkNativePermission("checkBatteryOptimization", "ignored"),
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
      store.dispose()
    })
  },
})

export default onboardingPlugin
