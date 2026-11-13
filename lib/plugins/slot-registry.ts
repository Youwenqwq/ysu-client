import type {
  PluginSlotContribution,
  PluginSlotDeclaration,
  PluginSlotService,
} from "@orahako/plugin-sdk"
import type { PluginServiceFactory } from "./runtime"
import { trackPluginRegistration } from "./track-registration"

export interface RegisteredPluginSlot extends PluginSlotDeclaration {
  pluginId: string
}

export interface RegisteredPluginSlotContribution extends PluginSlotContribution<object> {
  pluginId: string
  generation: number
}

export interface PluginSlotSnapshot {
  declarations: readonly RegisteredPluginSlot[]
  contributions: readonly RegisteredPluginSlotContribution[]
}

export class PluginSlotRegistry {
  private readonly declarations = new Map<string, RegisteredPluginSlot>()
  private readonly contributions = new Map<string, RegisteredPluginSlotContribution>()
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private snapshot: PluginSlotSnapshot = { declarations: [], contributions: [] }

  createService: PluginServiceFactory = (ctx, manifest) => {
    const track = (register: () => () => void) => trackPluginRegistration(ctx, register)
    const service: PluginSlotService = {
      declare: (declaration) => track(() => this.declare(manifest.id, declaration)),
      register: (contribution) => track(() => this.register(manifest.id, contribution)),
    }
    ctx.set("slots", service)
  }

  getSnapshot = (): PluginSlotSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  select(name: string, itemKey?: string): readonly RegisteredPluginSlotContribution[] {
    const declaration = this.snapshot.declarations.find((slot) => slot.name === name)
    if (!declaration) return []
    const matching = this.snapshot.contributions.filter((contribution) => {
      if (contribution.slot !== name) return false
      return declaration.kind !== "keyed" || contribution.key === itemKey
    })
    if (declaration.kind === "list") return matching
    return matching
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.id.localeCompare(b.id))
      .slice(0, 1)
  }

  private declare(pluginId: string, declaration: PluginSlotDeclaration): () => void {
    if (!declaration.name) throw new Error("Plugin slot name must not be empty")
    if (!["single", "list", "keyed"].includes(declaration.kind)) {
      throw new Error(`Invalid plugin slot kind: ${declaration.kind}`)
    }
    const existing = this.declarations.get(declaration.name)
    if (existing) {
      throw new Error(`Plugin slot already declared: ${declaration.name} (${existing.pluginId})`)
    }
    const registered = { ...declaration, pluginId }
    this.declarations.set(declaration.name, registered)
    this.publish()
    return () => {
      if (this.declarations.get(declaration.name) !== registered) return
      this.declarations.delete(declaration.name)
      for (const [key, contribution] of this.contributions) {
        if (contribution.slot === declaration.name) this.contributions.delete(key)
      }
      this.publish()
    }
  }

  private register<Props extends object>(
    pluginId: string,
    contribution: PluginSlotContribution<Props>
  ): () => void {
    if (!contribution.id) throw new Error("Plugin slot contribution ID must not be empty")
    const declaration = this.declarations.get(contribution.slot)
    if (!declaration) throw new Error(`Plugin slot is not declared: ${contribution.slot}`)
    if (declaration.kind === "keyed" && !contribution.key) {
      throw new Error(`Keyed plugin slot contribution requires a key: ${contribution.slot}`)
    }
    if (declaration.kind !== "keyed" && contribution.key !== undefined) {
      throw new Error(
        `Only keyed plugin slot contributions may declare a key: ${contribution.slot}`
      )
    }
    const key = `${pluginId}:${contribution.slot}:${contribution.id}`
    if (this.contributions.has(key)) {
      throw new Error(`Plugin slot contribution already registered: ${key}`)
    }
    const registered = {
      ...contribution,
      pluginId,
      generation: ++this.generation,
    } as RegisteredPluginSlotContribution
    this.assertUnambiguous(registered)
    this.contributions.set(key, registered)
    this.publish()
    return () => {
      if (this.contributions.get(key) !== registered) return
      this.contributions.delete(key)
      this.publish()
    }
  }

  private assertUnambiguous(candidate: RegisteredPluginSlotContribution): void {
    const declaration = this.declarations.get(candidate.slot)
    if (declaration?.kind === "list") return
    for (const contribution of this.contributions.values()) {
      if (contribution.slot !== candidate.slot) continue
      if (declaration?.kind === "keyed" && contribution.key !== candidate.key) continue
      if ((contribution.priority ?? 100) === (candidate.priority ?? 100)) {
        throw new Error(
          `Plugin slot contribution has an ambiguous priority: ${candidate.slot} (${candidate.priority ?? 100})`
        )
      }
    }
  }

  private publish(): void {
    this.snapshot = {
      declarations: Array.from(this.declarations.values()),
      contributions: Array.from(this.contributions.values()).sort(
        (a, b) =>
          (a.order ?? 100) - (b.order ?? 100) ||
          (a.priority ?? 100) - (b.priority ?? 100) ||
          a.id.localeCompare(b.id)
      ),
    }
    for (const listener of this.listeners) listener()
  }
}
