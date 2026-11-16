import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type AcademicPluginContext,
  type NavigationSources,
  type NavigationTarget,
  type PluginNavigationDefinition,
  type PluginNavigationService,
  type PluginProviderRuntimeService,
  type PluginUIService,
} from "@orahako/plugin-sdk"
import type { AcademicProvider } from "@orahako/plugin-sdk/academic"
import {
  navigationForScope,
  resolvePrimaryTarget,
  resolveSemanticTarget,
  semanticTargetHref,
} from "./navigation/resolvers"

export interface NavigationRuntimeConfig {
  /** App-owned destination used when neither the preference nor a primary page resolves. */
  fallbackHref?: string
}

type NavigationUISource = Pick<PluginUIService, "getSnapshot">
type NavigationProviderSource = Pick<PluginProviderRuntimeService, "getSnapshot">

/**
 * Resolves semantic routes from the live root registries. The service owns no
 * plugin identities: pages, navigation, capabilities, and the allowlist all come
 * from the UI and Provider snapshots, while the landing fallback is composition
 * configuration rather than a core route.
 */
export class NavigationRuntimeService implements PluginNavigationService {
  constructor(
    private readonly ui: NavigationUISource,
    private readonly provider: NavigationProviderSource,
    private readonly fallbackHref?: string
  ) {}

  sources(): NavigationSources {
    const { pages, navigation } = this.ui.getSnapshot()
    const provider = this.provider.getSnapshot().provider as AcademicProvider | null
    return {
      pages,
      navigation,
      capabilities: provider?.capabilities,
      supportedPlugins: provider?.supportedPlugins,
      ...(this.fallbackHref !== undefined ? { fallbackHref: this.fallbackHref } : {}),
    }
  }

  resolve(id: string): NavigationTarget | undefined {
    const sources = this.sources()
    const target = resolveSemanticTarget(id, sources)
    if (!target) return undefined
    const page = sources.pages.find(
      (candidate) => candidate.pluginId === target.pluginId && candidate.id === target.pageId
    )
    return { ...target, source: page?.route === id ? "page" : "navigation" }
  }

  primary(): NavigationTarget | undefined {
    const target = resolvePrimaryTarget(this.sources())
    return target ? { ...target, source: "page" } : undefined
  }

  landing(preference: string): string {
    const target = this.resolve(preference) ?? this.primary()
    return target ? semanticTargetHref(target) : (this.fallbackHref ?? "")
  }

  forScope<T extends PluginNavigationDefinition>(scope: "app" | "plugin", pluginId?: string): T[] {
    const sources = this.sources()
    const items =
      scope === "app"
        ? navigationForScope(sources.navigation, "app", sources, pluginId)
        : navigationForScope(sources.navigation, "plugin", sources, pluginId)
    return items as unknown as T[]
  }
}

export const navigationRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.navigation",
    name: "导航服务",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "由 UI 注册表与 Provider 快照解析语义路由、默认首页与作用域导航",
    inject: ["ui", "provider"],
    provides: ["navigation"],
    configSchema: {
      type: "object",
      properties: {
        fallbackHref: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  definition: definePlugin((baseCtx, config: NavigationRuntimeConfig = {}) => {
    const ctx = baseCtx as unknown as AcademicPluginContext
    ctx.set(
      "navigation",
      new NavigationRuntimeService(ctx.ui, ctx.provider, config.fallbackHref)
    )
  }),
}
