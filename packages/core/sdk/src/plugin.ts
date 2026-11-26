import { Context, Service, type Events } from "@cordisjs/core"
import type { PluginManifest } from "./manifest"
import "./services"

export { Context, Service }
export type { Events }

export type PluginConfig = Record<string, unknown>

/**
 * A root service may implement this protocol when consumers need a facade
 * bound to their own plugin identity. The runtime recreates the facade whenever
 * Cordis restarts the consumer after a root-service replacement.
 */
export const PLUGIN_SERVICE_SCOPE = Symbol.for("orahako.plugin-service.scope")

export interface ScopedPluginService<F = unknown> {
  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): F
}

export function isScopedPluginService(value: unknown): value is ScopedPluginService {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    PLUGIN_SERVICE_SCOPE in value
  )
}

/**
 * Attaches disposal via `ctx.effect` before publishing a registration. A
 * continuation holding a disposed plugin context throws `INACTIVE_EFFECT`
 * before it can leak global state.
 */
export function trackPluginRegistration(
  ctx: Pick<Context, "effect">,
  register: () => () => void
): () => void {
  return ctx.effect(() => register())
}

type BuiltinCordisKeys =
  | "using"
  | "inject"
  | "plugin"
  | "scope"
  | "runtime"
  | "effect"
  | "collect"
  | "accept"
  | "decline"
  | "get"
  | "set"
  | "provide"
  | "accessor"
  | "alias"
  | "mixin"
  | "parallel"
  | "emit"
  | "serial"
  | "waterfall"
  | "bail"
  | "on"
  | "once"
  | "off"
  | "start"
  | "stop"
  | "root"
  | "lifecycle"
  | "reflect"
  | "registry"
  | "config"
  | "name"
  | "events"
  | "state"
  | "extend"
  | "isolate"
  | "intercept"

export type InjectableServiceKey = Exclude<Extract<keyof Context, string>, BuiltinCordisKeys>

export type CordisLifecycleKeys =
  | typeof Context.events
  | "lifecycle"
  | "effect"
  | "on"
  | "once"
  | "off"
  | "emit"
  | "parallel"
  | "serial"
  | "bail"

export interface PluginServiceSetter {
  set<S extends InjectableServiceKey>(
    name: S,
    value: Context[S] | ScopedPluginService<Context[S]> | undefined
  ): () => void
}

/**
 * Optional services remain visible on the scoped context but may be absent
 * at runtime. Cordis keeps such plugins active; the kernel remounts them when
 * the optional service appears, is replaced, or is revoked.
 */
export type OptionalScopedPluginServices<O extends readonly InjectableServiceKey[]> = {
  [P in O[number]]?: Context[P]
}

/**
 * Statically exposes ONLY the services declared in `inject` plus optional
 * services from `optionalInject`, Cordis lifecycle/event methods and typed
 * service registration (`set`).
 */
export type ScopedPluginContext<
  K extends readonly InjectableServiceKey[] = readonly [],
  O extends readonly InjectableServiceKey[] = readonly [],
> = Pick<Context, CordisLifecycleKeys | K[number]> &
  OptionalScopedPluginServices<O> &
  PluginServiceSetter

export interface PluginSpec<
  K extends readonly InjectableServiceKey[] = readonly [],
  C extends PluginConfig = PluginConfig,
  O extends readonly InjectableServiceKey[] = readonly [],
> {
  readonly manifest: PluginManifest
  readonly inject?: K
  readonly optionalInject?: O
  readonly configSchema?: Record<string, unknown>
  apply(ctx: ScopedPluginContext<K, O>, config: C): void | Promise<void>
}

export interface DefinedPlugin<
  K extends readonly InjectableServiceKey[] = readonly InjectableServiceKey[],
  C extends PluginConfig = PluginConfig,
  O extends readonly InjectableServiceKey[] = readonly InjectableServiceKey[],
> {
  readonly manifest: PluginManifest
  readonly inject: readonly K[number][]
  readonly optionalInject: readonly O[number][]
  readonly configSchema?: Record<string, unknown>
  apply(ctx: ScopedPluginContext<K, O>, config: C): void | Promise<void>
}

export interface AnyDefinedPlugin {
  readonly manifest: PluginManifest
  readonly inject: readonly InjectableServiceKey[]
  readonly optionalInject?: readonly InjectableServiceKey[]
  readonly configSchema?: Record<string, unknown>
  apply(ctx: Context, config: never): void | Promise<void>
}

export function definePlugin<
  const K extends readonly InjectableServiceKey[] = readonly [],
  C extends PluginConfig = PluginConfig,
  const O extends readonly InjectableServiceKey[] = readonly [],
>(spec: PluginSpec<K, C, O>): DefinedPlugin<K, C, O> {
  const mergedInject = Array.from(
    new Set<string>([...(spec.manifest.inject ?? []), ...(spec.inject ?? [])])
  )
  const resolvedOptionalInject: O[number][] = Array.from(
    new Set<O[number]>(spec.optionalInject ?? [])
  ).filter((name) => !mergedInject.includes(name))
  const resolvedSchema = spec.configSchema ?? spec.manifest.configSchema
  const manifest: PluginManifest = {
    ...spec.manifest,
    ...(mergedInject.length > 0 ? { inject: mergedInject } : {}),
    ...(resolvedSchema !== undefined ? { configSchema: resolvedSchema } : {}),
  }
  const resolvedInject: readonly K[number][] = spec.inject ? [...spec.inject] : []

  return {
    manifest,
    inject: resolvedInject,
    optionalInject: resolvedOptionalInject,
    ...(resolvedSchema !== undefined ? { configSchema: resolvedSchema } : {}),
    apply: spec.apply,
  }
}
