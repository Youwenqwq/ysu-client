import type { PluginConfig, PluginDefinition } from "./runtime"
import type { PluginManifest } from "./manifest"

export interface CompositionDefaults {
  /** Fully-qualified shell key: `<plugin-id>:<shell-id>`. */
  shell?: string
  schoolId?: string
  landing?: string
}

export interface CompositionEntry {
  id: string
  config?: PluginConfig
  /** Composition policy, not a privilege granted by the plugin itself. */
  protected?: boolean
  disabled?: boolean
}

/** Pure, inspectable application choices. It contains no executable imports. */
export interface CompositionIdentity {
  name: string
  shortName: string
  nameEn: string
  description: string
  descriptionEn: string
  applicationId: string
  deepLinkScheme: string
  shortcuts?: readonly { id: string; name: string; nameEn: string }[]
}

export interface AppComposition {
  id: string
  version: 1
  identity?: CompositionIdentity
  defaults: CompositionDefaults
  nativeCapabilities?: readonly string[]
  market?: { indexUrl: string }
  plugins: readonly CompositionEntry[]
}

export interface CompositionPlugin {
  manifest: PluginManifest
  definition: PluginDefinition<PluginConfig>
}

/** Executable modules are resolved separately from the auditable composition. */
export interface CompositionSource {
  /** Installed application version used for market/update compatibility. */
  appVersion: string
  /** Build identifier used by plugin crash-recovery bookkeeping. */
  appBuild: string
  composition: AppComposition
  plugins: readonly CompositionPlugin[]
  layers?: readonly CompositionLayer[]
}

export interface CompositionEntryPatch {
  id?: string
  insert?: readonly CompositionEntry[]
  config?: PluginConfig
  protected?: boolean
  disabled?: boolean
}

export interface CompositionLayer {
  id: string
  defaults?: Partial<CompositionDefaults>
  plugins?: readonly CompositionEntryPatch[]
}

/**
 * Applies ordered layers with Harness-style shallow row replacement. Config is
 * replaced wholesale; rows are never deleted, only disabled. Unknown IDs and
 * duplicate insertions fail loudly instead of silently changing another app.
 */
export function composeApplication(
  base: AppComposition,
  layers: readonly CompositionLayer[] = []
): AppComposition {
  const entries = base.plugins.map((entry) => ({ ...entry }))
  let defaults = { ...base.defaults }
  for (const layer of layers) {
    defaults = { ...defaults, ...layer.defaults }
    for (const patch of layer.plugins ?? []) {
      if (patch.insert) {
        if (patch.id) throw new Error(`Composition insert must not declare an id: ${layer.id}`)
        const inserted = patch.insert.map((entry) => ({ ...entry }))
        const ids = new Set(entries.map((entry) => entry.id))
        for (const entry of inserted) {
          if (ids.has(entry.id)) throw new Error(`Duplicate composition entry: ${entry.id}`)
          ids.add(entry.id)
        }
        entries.push(...inserted)
        continue
      }
      if (!patch.id) throw new Error(`Composition patch requires an id: ${layer.id}`)
      const index = entries.findIndex((entry) => entry.id === patch.id)
      if (index < 0) throw new Error(`Unknown composition entry ${patch.id} in ${layer.id}`)
      const overrides: Partial<CompositionEntry> = {}
      if (patch.config !== undefined) overrides.config = patch.config
      if (patch.protected !== undefined) overrides.protected = patch.protected
      if (patch.disabled !== undefined) overrides.disabled = patch.disabled
      entries[index] = { ...entries[index], ...overrides }
    }
  }
  return { ...base, defaults, plugins: entries }
}
