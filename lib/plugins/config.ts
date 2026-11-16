import Ajv from "ajv"
import type {
  CompositionSource,
  PluginConfig,
  PluginManifest,
} from "@orahako/plugin-sdk"

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false })

export function validatePluginConfig(
  manifest: PluginManifest,
  config: PluginConfig = {}
): PluginConfig {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Plugin config must be an object: ${manifest.id}`)
  }
  const resolved = structuredClone(config)
  if (!manifest.configSchema) return resolved
  const validate = ajv.compile(manifest.configSchema)
  if (!validate(resolved)) {
    const details = validate.errors
      ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ")
    throw new Error(`Invalid config for ${manifest.id}: ${details}`)
  }
  return resolved
}

export function validateCompositionSource(source: CompositionSource): void {
  const modules = new Map<string, CompositionSource["plugins"][number]>()
  for (const plugin of source.plugins) {
    if (modules.has(plugin.manifest.id)) {
      throw new Error(`Duplicate composition module: ${plugin.manifest.id}`)
    }
    modules.set(plugin.manifest.id, plugin)
  }
  const entries = new Set<string>()
  for (const entry of source.composition.plugins) {
    if (entries.has(entry.id)) throw new Error(`Duplicate composition entry: ${entry.id}`)
    entries.add(entry.id)
    const plugin = modules.get(entry.id)
    if (!plugin) throw new Error(`Composition module is not available: ${entry.id}`)
    validatePluginConfig(plugin.manifest, entry.config)
  }
}
