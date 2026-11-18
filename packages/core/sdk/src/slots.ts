import type { Context } from "@cordisjs/core"
import type { ReactNode } from "react"
import type { PluginLocale, Translator } from "./i18n"
import type { ObservableSource } from "./observable"
import type { BoundActions, StoreDefinition, StoreInstance } from "./store"

export type SlotKind = "single" | "list" | "keyed" | "chain"

export interface SlotEntry<
  Kind extends SlotKind = SlotKind,
  Owner extends object = Record<string, never>,
> {
  readonly kind: Kind
  readonly owner: Owner
}

/**
 * Open slot registry augmented by shell and feature plugins via
 * `declare module "@orahako/sdk" { interface SlotMap { ... } }`.
 */
export interface SlotMap {
  root: {
    kind: "single"
    owner: Record<string, never>
  }
}

export type SlotName = keyof SlotMap & string

export type SlotKindOf<S extends SlotName> = SlotMap[S]["kind"]

export type SlotOwnerOf<S extends SlotName> = SlotMap[S]["owner"]

export type IsEmptyOwner<O> = [O[keyof O]] extends [never] ? true : false

export type NormalizeOwner<O> = IsEmptyOwner<O> extends true ? unknown : Readonly<O>

export type SlotComponentOwner<S extends SlotName> =
  SlotKindOf<S> extends "chain"
    ? NormalizeOwner<SlotOwnerOf<S>> & { readonly children: ReactNode }
    : SlotOwnerOf<S>

/**
 * Declares child slots into existence and statically authorizes ONLY the
 * declaring component to render them via `renderSlot` / `renderSlotChain`.
 */
export type ChildrenSpec = {
  readonly [K in SlotName]?: {
    readonly kind: SlotMap[K]["kind"]
  }
}

export type NonChainSlotKeys<Children extends ChildrenSpec> = {
  [K in keyof Children & SlotName]: NonNullable<Children[K]>["kind"] extends "chain" ? never : K
}[keyof Children & SlotName]

export type ChainSlotKeys<Children extends ChildrenSpec> = {
  [K in keyof Children & SlotName]: NonNullable<Children[K]>["kind"] extends "chain" ? K : never
}[keyof Children & SlotName]

export interface RenderSlotOptions {
  readonly key?: string
  readonly fallback?: ReactNode
}

export type RenderSlotFn<Allowed extends SlotName> = <K extends Allowed>(
  slot: K,
  ...args: IsEmptyOwner<SlotOwnerOf<K>> extends true
    ? [owner?: SlotOwnerOf<K>, options?: RenderSlotOptions]
    : [owner: SlotOwnerOf<K>, options?: RenderSlotOptions]
) => ReactNode

export type RenderSlotChainFn<Allowed extends SlotName> = <K extends Allowed>(
  slot: K,
  ...args: IsEmptyOwner<SlotOwnerOf<K>> extends true
    ? [children: ReactNode] | [owner: SlotOwnerOf<K>, children: ReactNode]
    : [owner: SlotOwnerOf<K>, children: ReactNode]
) => ReactNode

/**
 * Share 1: Owner props passed by the parent slot + localized `t` and `locale`.
 */
export type PropsRuntime<
  Owner extends object = Record<string, never>,
  Dict = undefined,
> = NormalizeOwner<Owner> & {
  readonly t: Translator<Dict>
  readonly locale: PluginLocale
}

/**
 * Share 2: Child slot renderers narrowed strictly to the component's `children` spec.
 */
export type PropsRenderSlots<Children extends ChildrenSpec | undefined = undefined> = ([
  NonChainSlotKeys<NonNullable<Children>>,
] extends [never]
  ? unknown
  : {
      readonly renderSlot: RenderSlotFn<NonChainSlotKeys<NonNullable<Children>>>
    }) &
  ([ChainSlotKeys<NonNullable<Children>>] extends [never]
    ? unknown
    : {
        readonly renderSlotChain: RenderSlotChainFn<ChainSlotKeys<NonNullable<Children>>>
      })

/**
 * Share 3: Bound store selector hook and actions (never exposing raw `StoreInstance`).
 */
export type PropsStore<Store = undefined> = [Store] extends [undefined]
  ? unknown
  : Store extends StoreInstance<infer S, infer A> | StoreDefinition<infer S, infer A>
    ? {
        readonly useStore: <R = S>(selector?: (state: S) => R) => R
        readonly actions: BoundActions<A>
      }
    : unknown

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ObservableMap = Readonly<Record<string, ObservableSource<any>>>

export type HookFace<H> = {
  readonly [K in keyof H & string as `use${Capitalize<K>}`]: H[K] extends ObservableSource<infer V>
    ? <R = V>(selector?: (value: V) => R) => R
    : never
}

export type ValidInject<I> = I extends { readonly hooks: infer H }
  ? H extends ObservableMap
    ? I
    : Omit<I, "hooks"> & { readonly hooks: ObservableMap }
  : I

/**
 * Share 4: Plain data & callbacks returned by `inject(ctx)`, with `hooks`
 * observables mapped to `use<Capitalize<Name>>` selector hooks so components
 * never receive raw `ObservableSource` instances.
 */
export type InjectFace<I = undefined> = [I] extends [undefined]
  ? unknown
  : Omit<I, "hooks"> &
      (I extends { readonly hooks?: infer H }
        ? [NonNullable<H>] extends [never]
          ? unknown
          : HookFace<NonNullable<H>>
        : unknown)

export type DerivedComponentProps<
  Owner extends object = Record<string, never>,
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> = PropsRuntime<Owner, Dict> & PropsRenderSlots<Children> & PropsStore<Store> & InjectFace<I>

/**
 * Pure slot/page/settings/widget component call signature (NOT `React.FC`).
 */
export type SlotComponent<P = Record<string, never>> = (props: P) => ReactNode

export type SlotKeyField<S extends SlotName> =
  SlotKindOf<S> extends "keyed" ? { readonly key: string } : { readonly key?: string }

export type SlotRegistrationSpec<
  S extends SlotName = SlotName,
  Dict = undefined,
  Children extends ChildrenSpec | undefined = undefined,
  Store = undefined,
  I = undefined,
> = {
  readonly id?: string
  readonly slot: S
  /** Lower values win for single and keyed slots. */
  readonly priority?: number
  /** Ascending render order for list and chain slots. */
  readonly order?: number
  readonly dictionary?: Dict
  readonly children?: Children
  readonly store?: Store
  readonly inject?: (ctx: Context) => ValidInject<I>
} & SlotKeyField<S>

export interface PluginSlotDeclaration {
  readonly name: SlotName
  readonly kind: SlotKind
}

export interface SlotContribution {
  readonly id: string
  readonly pluginId: string
  readonly slot: SlotName
  readonly priority?: number
  readonly order?: number
  readonly key?: string
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
  readonly generation: number
}

export type SlotInjectCallback = (ctx: Context) => void | (() => void)

export interface PluginSlotService {
  register<
    S extends SlotName,
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I>,
    Component: SlotComponent<
      NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
    >
  ): () => void
  register<
    S extends SlotName,
    Dict = undefined,
    const Children extends ChildrenSpec | undefined = undefined,
    Store = undefined,
    I = undefined,
  >(
    spec: SlotRegistrationSpec<S, Dict, Children, Store, I> & {
      readonly component: SlotComponent<
        NoInfer<DerivedComponentProps<SlotComponentOwner<S>, Dict, Children, Store, I>>
      >
    }
  ): () => void
  /**
   * Runs `callback` once `slotName` is declared, unwinds its returned disposer
   * when that declaration is disposed, and re-runs if `slotName` is redeclared.
   */
  inject<S extends SlotName>(slotName: S, callback: SlotInjectCallback): () => void
}

export interface PluginSlotRegistrySnapshot {
  readonly declarations: readonly PluginSlotDeclaration[]
  readonly contributions: readonly SlotContribution[]
}

export interface PluginSlotRegistryService extends PluginSlotService {
  readonly state: ObservableSource<PluginSlotRegistrySnapshot>
  declare(slot: PluginSlotDeclaration): () => void
  getSnapshot(): PluginSlotRegistrySnapshot
  subscribe(listener: () => void): () => void
  select(name: SlotName, itemKey?: string): readonly SlotContribution[]
}
