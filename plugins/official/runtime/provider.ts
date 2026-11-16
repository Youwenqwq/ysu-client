import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type PluginConfig,
  type PluginDefinition,
  type PluginSessionService,
} from "@orahako/plugin-sdk"
import { ProviderRuntime, type ProviderCatalog } from "./provider/runtime"

export interface ProviderRuntimeConfig extends PluginConfig {
  /** School selected when the session has not activated one. */
  defaultSchoolId?: string
}

const definition: PluginDefinition<ProviderRuntimeConfig> = definePlugin(
  (ctx, config: ProviderRuntimeConfig = {}) => {
    // `ctx.providers` is the scoped contribution facade; the runtime needs the
    // root catalog instance to create providers and observe factory changes.
    const catalogs = ctx.root.get("providers") as unknown as Partial<ProviderCatalog> | undefined
    if (
      !catalogs ||
      typeof catalogs.hasProvider !== "function" ||
      typeof catalogs.createProvider !== "function" ||
      typeof catalogs.subscribe !== "function"
    ) {
      throw new Error("Provider runtime requires the provider registry catalog service")
    }
    const registry = catalogs as ProviderCatalog
    const runtime = new ProviderRuntime({
      ctx,
      registry,
      session: ctx.get("session") as PluginSessionService,
      defaultSchoolId: config.defaultSchoolId,
    })
    ctx.set("provider", runtime)
    ctx.on("dispose", () => runtime.dispose())
  }
)

export const providerRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.provider",
    name: "Provider lifecycle runtime",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "Selected school provider, generation-safe initialization and auth transitions",
    inject: ["providers", "session"],
    provides: ["provider"],
    configSchema: {
      type: "object",
      properties: {
        defaultSchoolId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  definition,
}
