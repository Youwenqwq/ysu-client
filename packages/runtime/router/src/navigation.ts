import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type NavigationFilter,
  type NavigationSources,
  type NavigationTarget,
  type ObservableSource,
  type PluginManifest,
  type PluginNavigationContribution,
  type PluginNavigationDefinition,
  type PluginNavigationScope,
  type PluginNavigationService,
  type PluginUIService,
  type ScopedPluginService,
} from "@orahako/sdk"
import {
  navigationForScope,
  pageAvailable,
  resolvePrimaryTarget,
  resolveSemanticTarget,
  semanticTargetHref,
  type SemanticNavSources,
} from "./resolvers"

export const NAVIGATION_RUNTIME_PLUGIN_ID = "orahako.runtime.navigation"

export interface NavigationRuntimeConfig {
  readonly fallbackHref?: string
  readonly [key: string]: unknown
}

export type NavigationUISource = Pick<PluginUIService, "state" | "getSnapshot">

export class NavigationRuntimeService
  implements PluginNavigationService, ScopedPluginService<PluginNavigationService>
{
  readonly state: ObservableSource<number>
  private readonly stateSource = createObservableSource<number>(0)
  private readonly filters = new Set<NavigationFilter>()
  private readonly unsubscribeUI: () => void

  constructor(
    private readonly ui: NavigationUISource,
    private readonly fallbackHref?: string
  ) {
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
    this.unsubscribeUI = this.ui.state.subscribe(() => {
      this.bump()
    })
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, _manifest: PluginManifest): PluginNavigationService {
    const forScope = this.forScope.bind(this)
    return {
      state: this.state,
      sources: this.sources,
      resolve: this.resolve,
      primary: this.primary,
      landing: this.landing,
      available: this.available,
      forScope,
      registerFilter: (filter) => trackPluginRegistration(ctx, () => this.registerFilter(filter)),
    }
  }

  sources = (): NavigationSources => {
    const { pages, navigation } = this.ui.getSnapshot()
    return {
      pages,
      navigation,
      ...(this.fallbackHref !== undefined ? { fallbackHref: this.fallbackHref } : {}),
    }
  }

  resolve = (id: string): NavigationTarget | undefined => {
    const internalSources = this.internalSources()
    const target = resolveSemanticTarget(id, internalSources)
    if (!target) return undefined
    const page = internalSources.pages.find(
      (candidate) => candidate.pluginId === target.pluginId && candidate.id === target.pageId
    )
    return {
      pluginId: target.pluginId,
      pageId: target.pageId,
      source: page?.route === id ? "page" : "navigation",
    }
  }

  primary = (): NavigationTarget | undefined => {
    const target = resolvePrimaryTarget(this.internalSources())
    return target ? { ...target, source: "page" } : undefined
  }

  landing = (preference: string): string => {
    const target = this.resolve(preference) ?? this.primary()
    return target ? semanticTargetHref(target) : (this.fallbackHref ?? "")
  }

  available = (pluginId: string, pageId: string): boolean => {
    const sources = this.internalSources()
    const page = sources.pages.find(
      (candidate) => candidate.pluginId === pluginId && candidate.id === pageId
    )
    return page ? pageAvailable(sources, page) : false
  }

  forScope<T extends PluginNavigationDefinition = PluginNavigationContribution>(
    scope: PluginNavigationScope,
    pluginId?: string
  ): readonly T[]
  forScope(
    scope: PluginNavigationScope,
    pluginId?: string
  ): readonly PluginNavigationContribution[] {
    const { pages, navigation } = this.ui.getSnapshot()
    const filterSources = {
      pages,
      filters: Array.from(this.filters),
    }
    return scope === "app"
      ? navigationForScope(navigation, "app", filterSources, pluginId)
      : navigationForScope(navigation, "plugin", filterSources, pluginId)
  }

  registerFilter = (filter: NavigationFilter): (() => void) => {
    this.filters.add(filter)
    this.bump()
    let removed = false
    return () => {
      if (removed) return
      removed = true
      if (this.filters.delete(filter)) {
        this.bump()
      }
    }
  }

  dispose(): void {
    this.unsubscribeUI()
    this.filters.clear()
  }

  private internalSources(): SemanticNavSources {
    const { pages, navigation } = this.ui.getSnapshot()
    return {
      pages,
      navigation,
      filters: Array.from(this.filters),
      ...(this.fallbackHref !== undefined ? { fallbackHref: this.fallbackHref } : {}),
    }
  }

  private bump(): void {
    this.stateSource.set((value) => value + 1)
  }
}

export const navigationRuntimePlugin = definePlugin({
  manifest: {
    id: NAVIGATION_RUNTIME_PLUGIN_ID,
    name: "导航服务",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "由 UI 注册表与过滤规则解析语义路由、默认首页与作用域导航",
    provides: ["navigation"],
  },
  inject: ["ui"],
  configSchema: {
    type: "object",
    properties: {
      fallbackHref: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  apply(ctx, config: NavigationRuntimeConfig = {}) {
    const service = new NavigationRuntimeService(ctx.ui, config.fallbackHref)
    ctx.effect(() => () => {
      service.dispose()
    })
    ctx.set("navigation", service)
  },
})
