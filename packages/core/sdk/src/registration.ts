import type { Context } from "@cordisjs/core"
import type { PluginManifest } from "./manifest"
import { isScopedPluginService, PLUGIN_SERVICE_SCOPE } from "./plugin"
import type { PluginStorageService } from "./services"
import type {
  ChildrenSpec,
  PluginSlotDeclaration,
  PluginSlotRegistryService,
  SlotName,
} from "./slots"
import type { StoreDefinition } from "./store"

/** Runtime helper shared by the UI, settings and slot registries. */
export function isPluginStorageService(value: unknown): value is PluginStorageService {
  return typeof value === "object" && value !== null && "local" in value && "secure" in value
}

/** Resolves the storage backend bound to the registering plugin identity. */
export function resolvePluginStorage(
  ctx: Context,
  manifest: PluginManifest
): PluginStorageService | undefined {
  const raw: unknown = ctx.get("storage")
  if (!raw) return undefined
  if (isScopedPluginService(raw)) {
    const scoped = raw[PLUGIN_SERVICE_SCOPE](ctx, manifest)
    return isPluginStorageService(scoped) ? scoped : undefined
  }
  return isPluginStorageService(raw) ? raw : undefined
}

/** Runtime helper shared by the UI, settings and slot registries. */
export function isStoreDefinition(
  value: unknown
): value is StoreDefinition<unknown, Record<string, never>> {
  return (
    typeof value === "object" &&
    value !== null &&
    "create" in value &&
    typeof value.create === "function"
  )
}

export function isSlotRegistryService(value: unknown): value is PluginSlotRegistryService {
  return (
    typeof value === "object" &&
    value !== null &&
    "declare" in value &&
    typeof value.declare === "function"
  )
}

function resolveRootSlotRegistry(ctx: Context): PluginSlotRegistryService | undefined {
  const raw: unknown = ctx.root.get("slots")
  return isSlotRegistryService(raw) ? raw : undefined
}

function toDeclarations(children: ChildrenSpec): PluginSlotDeclaration[] {
  const declarations: PluginSlotDeclaration[] = []
  for (const [name, spec] of Object.entries(children)) {
    if (spec) {
      declarations.push({ name: name as SlotName, kind: spec.kind })
    }
  }
  return declarations
}

/**
 * Declares every child slot owned by a page, settings category or shell that
 * opted into automatic declaration. Duplicate declarations intentionally throw.
 */
export function declareContributionChildren(
  ctx: Context | undefined,
  children: ChildrenSpec | undefined
): () => void {
  if (!ctx || !children) return () => {}
  const entries = toDeclarations(children)
  if (entries.length === 0) return () => {}

  let disposed = false
  let childDisposers: Array<() => void> = []
  let stopServiceListener: (() => void) | undefined

  const applyDeclarations = (slots: PluginSlotRegistryService): void => {
    const created: Array<() => void> = []
    try {
      for (const entry of entries) {
        created.push(slots.declare(entry))
      }
      childDisposers = created
    } catch (error) {
      for (let i = created.length - 1; i >= 0; i -= 1) {
        created[i]?.()
      }
      throw error
    }
  }

  const rootSlots = resolveRootSlotRegistry(ctx)
  if (rootSlots) {
    applyDeclarations(rootSlots)
  } else {
    stopServiceListener = ctx.on("internal/service", (serviceName: string) => {
      if (disposed || serviceName !== "slots" || childDisposers.length > 0) return
      const lateSlots = resolveRootSlotRegistry(ctx)
      if (lateSlots) {
        applyDeclarations(lateSlots)
      }
    })
  }

  return () => {
    if (disposed) return
    disposed = true
    stopServiceListener?.()
    stopServiceListener = undefined
    const toDispose = childDisposers
    childDisposers = []
    for (let i = toDispose.length - 1; i >= 0; i -= 1) {
      toDispose[i]?.()
    }
  }
}

/**
 * Validates a shell's `children` when `declareChildren` is false. The shell must
 * already have claimed the same name/kind through the scoped slot service.
 */
export function assertContributionChildrenDeclared(
  ctx: Context | undefined,
  children: ChildrenSpec | undefined
): void {
  if (!children) return
  const entries = toDeclarations(children)
  if (entries.length === 0) return
  const slots = ctx ? resolveRootSlotRegistry(ctx) : undefined
  if (!slots) {
    throw new Error("Slot registry is unavailable while validating shell child slots")
  }
  const declared = new Map(slots.getSnapshot().declarations.map((item) => [item.name, item.kind]))
  for (const entry of entries) {
    const kind = declared.get(entry.name)
    if (kind === undefined) {
      throw new Error(`Plugin slot is not declared: ${entry.name}`)
    }
    if (kind !== entry.kind) {
      throw new Error(
        `Plugin slot kind mismatch: ${entry.name} (declared ${kind}, requested ${entry.kind})`
      )
    }
  }
}
