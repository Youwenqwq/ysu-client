import type { Context } from "@cordisjs/core"
import type { PluginManifest } from "./manifest"
import { isScopedPluginService, PLUGIN_SERVICE_SCOPE } from "./plugin"
import type { PluginStorageService } from "./services"
import type { ChildrenSpec, PluginSlotDeclaration, PluginSlotService, SlotName } from "./slots"
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

export function isPluginSlotService(value: unknown): value is PluginSlotService {
  return (
    typeof value === "object" &&
    value !== null &&
    "declare" in value &&
    typeof value.declare === "function" &&
    "register" in value &&
    typeof value.register === "function" &&
    "getSnapshot" in value &&
    typeof value.getSnapshot === "function"
  )
}

/**
 * Reads the slot service visible to the registering plugin. When the kernel
 * isolated a scoped facade for a declared `slots` dependency it is used as-is;
 * a raw root service is bound to the caller's identity once. Root internals
 * remain private to the caller's own service resolution - never `ctx.root`.
 */
export function resolvePluginSlots(
  ctx: Context,
  manifest: PluginManifest
): PluginSlotService | undefined {
  const raw: unknown = ctx.get("slots")
  if (!raw) return undefined
  if (isScopedPluginService(raw)) {
    const scoped = raw[PLUGIN_SERVICE_SCOPE](ctx, manifest)
    return isPluginSlotService(scoped) ? scoped : undefined
  }
  return isPluginSlotService(raw) ? raw : undefined
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
 * opted into automatic declaration. Declarations are owned exclusively: a
 * name already declared by another contribution throws, while a shell
 * sharing a public slot should claim it through `slots.declare` itself and
 * use `declareChildren: false`.
 */
export function declareContributionChildren(
  slots: PluginSlotService | undefined,
  children: ChildrenSpec | undefined
): () => void {
  if (!children) return () => {}
  const entries = toDeclarations(children)
  if (entries.length === 0) return () => {}
  // Registries that depend on `slots` via `optionalInject` are remounted by the
  // kernel when the service appears, so an early registration without slots is
  // replayed against the eventual service instead of failing startup.
  if (!slots) return () => {}

  const disposers: Array<() => void> = []
  try {
    for (const entry of entries) {
      if (
        slots.getSnapshot().declarations.some((declaration) => declaration.name === entry.name)
      ) {
        throw new Error(`Plugin slot already declared: ${entry.name}`)
      }
      disposers.push(slots.declare(entry))
    }
  } catch (error) {
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      disposers[i]?.()
    }
    throw error
  }

  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      disposers[i]?.()
    }
    disposers.length = 0
  }
}

/**
 * Validates a shell's `children` when `declareChildren` is false. The shell must
 * already have claimed the same name/kind through `slots.declare`.
 */
export function assertContributionChildrenDeclared(
  slots: PluginSlotService | undefined,
  children: ChildrenSpec | undefined
): void {
  if (!children) return
  const entries = toDeclarations(children)
  if (entries.length === 0) return
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
