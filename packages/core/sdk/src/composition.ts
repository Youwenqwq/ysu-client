import type { PluginManifest } from "./manifest"
import type { AnyDefinedPlugin, PluginConfig } from "./plugin"

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

/** Pure, inspectable application choices. Contains no executable imports. */
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
 * Pure-data stackable composition bundle (e.g. `bundle-platform` ->
 * `bundle-academic` -> `bundle-ysu`). Bundles declare plugin rows, defaults,
 * native capabilities, identity/market metadata, and optional row patches for
 * entries declared by lower bundles.
 */
export interface CompositionBundle {
  readonly id: string
  readonly identity?: CompositionIdentity
  readonly defaults?: Partial<CompositionDefaults>
  readonly nativeCapabilities?: readonly string[]
  readonly market?: { readonly indexUrl: string }
  readonly plugins?: readonly CompositionEntry[]
  readonly patches?: readonly CompositionEntryPatch[]
}

export function defineBundle<const B extends CompositionBundle>(bundle: B): B {
  return bundle
}

export interface LegacyCompositionPlugin {
  readonly manifest: PluginManifest
  readonly definition:
    | {
        readonly inject?: readonly string[]
        apply(ctx: never, config: never): void | Promise<void>
      }
    | ((ctx: never, config: never) => void | Promise<void>)
}

export type CompositionPlugin = AnyDefinedPlugin | LegacyCompositionPlugin

export interface CompositionSource {
  /** Installed application version used for market/update compatibility. */
  appVersion: string
  /** Build identifier used by plugin crash-recovery bookkeeping. */
  appBuild: string
  composition: AppComposition
  plugins: readonly CompositionPlugin[]
  layers?: readonly CompositionLayer[]
}

export interface ComposeBundlesOptions {
  readonly id?: string
  readonly layers?: readonly CompositionLayer[]
}

function applyPatches(
  entries: CompositionEntry[],
  layerId: string,
  patches: readonly CompositionEntryPatch[]
): void {
  for (const patch of patches) {
    if (patch.insert) {
      if (patch.id) throw new Error(`Composition insert must not declare an id: ${layerId}`)
      const inserted = patch.insert.map((entry) => ({ ...entry }))
      const ids = new Set(entries.map((entry) => entry.id))
      for (const entry of inserted) {
        if (ids.has(entry.id)) throw new Error(`Duplicate composition entry: ${entry.id}`)
        ids.add(entry.id)
      }
      entries.push(...inserted)
      continue
    }
    if (!patch.id) throw new Error(`Composition patch requires an id: ${layerId}`)
    const index = entries.findIndex((entry) => entry.id === patch.id)
    if (index < 0) throw new Error(`Unknown composition entry ${patch.id} in ${layerId}`)
    const overrides: Partial<CompositionEntry> = {}
    if (patch.config !== undefined) overrides.config = patch.config
    if (patch.protected !== undefined) overrides.protected = patch.protected
    if (patch.disabled !== undefined) overrides.disabled = patch.disabled
    entries[index] = { ...entries[index], ...overrides }
  }
}

/**
 * Stacks ordered pure-data bundles (`bundle-platform` -> `bundle-academic` ->
 * `bundle-ysu`) into an `AppComposition` and optionally applies `layers`.
 */
export function composeBundles(
  id: string,
  bundles: readonly CompositionBundle[],
  layers?: readonly CompositionLayer[]
): AppComposition
export function composeBundles(
  bundles: readonly CompositionBundle[],
  options?: ComposeBundlesOptions
): AppComposition
export function composeBundles(
  first: string | readonly CompositionBundle[],
  second?: readonly CompositionBundle[] | ComposeBundlesOptions,
  third?: readonly CompositionLayer[]
): AppComposition {
  let bundles: readonly CompositionBundle[]
  let id: string | undefined
  let layers: readonly CompositionLayer[] = []

  if (typeof first === "string") {
    id = first
    bundles = Array.isArray(second) ? second : []
    layers = third ?? []
  } else {
    bundles = first
    const opts = second && !Array.isArray(second) ? (second as ComposeBundlesOptions) : undefined
    id = opts?.id
    layers = opts?.layers ?? []
  }

  if (bundles.length === 0) {
    throw new Error("composeBundles requires at least one bundle")
  }

  const seenBundleIds = new Set<string>()
  const entries: CompositionEntry[] = []
  const seenPluginIds = new Set<string>()
  const capabilities: string[] = []
  const seenCapabilities = new Set<string>()
  let defaults: CompositionDefaults = {}
  let identity: CompositionIdentity | undefined
  let market: { indexUrl: string } | undefined

  for (const bundle of bundles) {
    if (seenBundleIds.has(bundle.id)) {
      throw new Error(`Duplicate bundle id: ${bundle.id}`)
    }
    seenBundleIds.add(bundle.id)

    if (bundle.identity !== undefined) {
      identity = bundle.identity
    }
    if (bundle.market !== undefined) {
      market = { indexUrl: bundle.market.indexUrl }
    }
    if (bundle.defaults !== undefined) {
      defaults = { ...defaults, ...bundle.defaults }
    }
    for (const capability of bundle.nativeCapabilities ?? []) {
      if (!seenCapabilities.has(capability)) {
        seenCapabilities.add(capability)
        capabilities.push(capability)
      }
    }
    for (const entry of bundle.plugins ?? []) {
      if (seenPluginIds.has(entry.id)) {
        throw new Error(`Duplicate composition entry: ${entry.id}`)
      }
      seenPluginIds.add(entry.id)
      entries.push({ ...entry })
    }
    if (bundle.patches && bundle.patches.length > 0) {
      applyPatches(entries, bundle.id, bundle.patches)
      for (const entry of entries) seenPluginIds.add(entry.id)
    }
  }

  const resolvedId = id ?? bundles[bundles.length - 1]!.id
  const base: AppComposition = {
    id: resolvedId,
    version: 1,
    ...(identity !== undefined ? { identity } : {}),
    defaults,
    ...(capabilities.length > 0 ? { nativeCapabilities: capabilities } : {}),
    ...(market !== undefined ? { market } : {}),
    plugins: entries,
  }

  return layers.length > 0 ? composeApplication(base, layers) : base
}

/**
 * Applies ordered layers with shallow row replacement. Config is replaced
 * wholesale; rows are never deleted, only disabled. Unknown IDs and duplicate
 * insertions fail loudly.
 */
export function composeApplication(
  base: AppComposition,
  layers: readonly CompositionLayer[] = []
): AppComposition {
  const entries = base.plugins.map((entry) => ({ ...entry }))
  let defaults = { ...base.defaults }
  for (const layer of layers) {
    defaults = { ...defaults, ...layer.defaults }
    applyPatches(entries, layer.id, layer.plugins ?? [])
  }
  return { ...base, defaults, plugins: entries }
}
