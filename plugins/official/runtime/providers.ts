import { definePlugin, PLUGIN_API_VERSION, type CompositionPlugin } from "@orahako/plugin-sdk"
import { ProviderPluginRegistry } from "./provider/registry"

export const providerRegistryRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.provider-registry",
    name: "Provider contribution registry",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["providers"],
  },
  definition: definePlugin((ctx) => {
    ctx.set("providers", new ProviderPluginRegistry())
  }),
}
