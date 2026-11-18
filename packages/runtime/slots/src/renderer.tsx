import { Context } from "@cordisjs/core"
import {
  Component,
  Fragment,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  resolveDictionaryMessage,
  type AppComposition,
  type ChildrenSpec,
  type DefinedDictionary,
  type DictionaryMessages,
  type ObservableSource,
  type PluginI18nRegistryService,
  type PluginLocale,
  type PluginShellContribution,
  type PluginSlotRegistryService,
  type PluginSlotRegistrySnapshot,
  type PluginUIRegistryService,
  type PluginUIServiceSnapshot,
  type RenderSlotOptions,
  type SlotComponent,
  type SlotKind,
  type SlotName,
  type StoreInstance,
} from "@orahako/sdk"

const SOURCE_HOOK_CACHE = new WeakMap<
  ObservableSource<never>,
  <R>(selector?: (value: never) => R) => R
>()

const EMPTY_SLOT_SNAPSHOT: PluginSlotRegistrySnapshot = {
  declarations: [],
  contributions: [],
}

const EMPTY_UI_SNAPSHOT: PluginUIServiceSnapshot = {
  pages: [],
  navigation: [],
  themes: [],
  shells: [],
}

const NOOP_UNSUBSCRIBE = () => {}
const NOOP_SUBSCRIBE = () => NOOP_UNSUBSCRIBE

const STATIC_EMPTY_SLOTS_SOURCE: ObservableSource<PluginSlotRegistrySnapshot> = {
  getSnapshot: () => EMPTY_SLOT_SNAPSHOT,
  subscribe: NOOP_SUBSCRIBE,
}

const STATIC_EMPTY_UI_SOURCE: ObservableSource<PluginUIServiceSnapshot> = {
  getSnapshot: () => EMPTY_UI_SNAPSHOT,
  subscribe: NOOP_SUBSCRIBE,
}

const STATIC_LOCALE_SOURCE: ObservableSource<PluginLocale> = {
  getSnapshot: () => "zh",
  subscribe: NOOP_SUBSCRIBE,
}

const STATIC_ZERO_SOURCE: ObservableSource<number> = {
  getSnapshot: () => 0,
  subscribe: NOOP_SUBSCRIBE,
}

const STATIC_EMPTY_ARRAY_SOURCE: ObservableSource<readonly unknown[]> = {
  getSnapshot: () => [],
  subscribe: NOOP_SUBSCRIBE,
}

const STATIC_UNDEFINED_STRING_SOURCE: ObservableSource<string | null | undefined> = {
  getSnapshot: () => undefined,
  subscribe: NOOP_SUBSCRIBE,
}

/**
 * Subscribes a React component to a framework-agnostic `ObservableSource`.
 * `UIRenderer` is the sole module in the system invoking `useSyncExternalStore`.
 */
export function useObservable<T>(source: ObservableSource<T>): T
export function useObservable<T, R>(source: ObservableSource<T>, selector: (value: T) => R): R
export function useObservable<T, R = T>(
  source: ObservableSource<T>,
  selector?: (value: T) => R
): T | R
export function useObservable<T, R = T>(
  source: ObservableSource<T>,
  selector?: (value: T) => R
): T | R {
  const getSelectedSnapshot = useMemo<() => T | R>(() => {
    if (!selector) return source.getSnapshot
    let initialized = false
    let prevRaw!: T
    let prevSelected!: R
    return (): R => {
      const raw = source.getSnapshot()
      if (initialized && Object.is(raw, prevRaw)) {
        return prevSelected
      }
      const selected = selector(raw)
      if (initialized && Object.is(selected, prevSelected)) {
        prevRaw = raw
        return prevSelected
      }
      initialized = true
      prevRaw = raw
      prevSelected = selected
      return selected
    }
  }, [source, selector])

  return useSyncExternalStore(source.subscribe, getSelectedSnapshot, getSelectedSnapshot)
}

/**
 * Returns a referentially stable selector hook `useX(selector?)` bound to a
 * specific `ObservableSource` instance.
 */
export function createObservableHook<T>(
  source: ObservableSource<T>
): <R = T>(selector?: (value: T) => R) => R {
  const key = source as ObservableSource<never>
  const existing = SOURCE_HOOK_CACHE.get(key)
  if (existing) {
    return existing as <R = T>(selector?: (value: T) => R) => R
  }
  const useBoundSource = <R = T,>(selector?: (value: T) => R): R =>
    useObservable(source, selector) as R
  SOURCE_HOOK_CACHE.set(key, useBoundSource as <R>(selector?: (value: never) => R) => R)
  return useBoundSource
}

function isObservableSource<T = unknown>(value: unknown): value is ObservableSource<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "getSnapshot" in value &&
    typeof value.getSnapshot === "function" &&
    "subscribe" in value &&
    typeof value.subscribe === "function"
  )
}

function isStoreInstance(
  value: unknown
): value is StoreInstance<unknown, Record<string, (...args: never[]) => unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    isObservableSource(value.source) &&
    "actions" in value &&
    typeof value.actions === "object" &&
    value.actions !== null
  )
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDictionaryMessages(value: unknown): value is DictionaryMessages {
  return isPlainObject(value)
}

function isDefinedDictionary(value: unknown): value is DefinedDictionary {
  return isPlainObject(value) && isDictionaryMessages(value.zh) && isDictionaryMessages(value.en)
}

function interpolateFallback(
  template: string,
  params?: Readonly<Record<string, string | number>>
): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

function isChainSlotKind(kind: SlotKind): boolean {
  return kind === "chain"
}

function capitalizeHookName(name: string): string {
  if (name.length === 0) return "use"
  return `use${name[0]!.toUpperCase()}${name.slice(1)}`
}

const FALLBACK_INJECT_CONTEXT = new Context()

function projectInjectResult(
  injectFn: ((ctx: Context) => unknown) | undefined
): Record<string, unknown> {
  if (!injectFn) return {}
  const raw = injectFn(FALLBACK_INJECT_CONTEXT)
  if (!isPlainObject(raw)) return {}

  const projected: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === "hooks") continue
    projected[key] = value
  }
  if ("hooks" in raw && isPlainObject(raw.hooks)) {
    for (const [hookKey, source] of Object.entries(raw.hooks)) {
      if (isObservableSource(source)) {
        projected[capitalizeHookName(hookKey)] = createObservableHook(source)
      }
    }
  }
  return projected
}

/**
 * Structural union satisfied by `SlotContribution`, `PluginShellContribution`,
 * `PluginPageContribution`, `PluginSettingsCategory`, and `OverviewWidgetContribution`.
 */
export interface RenderableContribution {
  readonly id: string
  readonly pluginId: string
  readonly dictionary?: unknown
  readonly children?: ChildrenSpec
  readonly store?: unknown
  readonly inject?: (ctx: Context) => unknown
  readonly component: SlotComponent<never>
  readonly generation?: number
}

export interface ContributionOutletProps<Owner extends object = Record<string, never>> {
  readonly entry: RenderableContribution
  readonly owner?: Owner
  readonly slots?: PluginSlotRegistryService
  readonly i18n?: PluginI18nRegistryService
  readonly errorFallback?: ReactNode
  readonly onError?: (error: Error) => void
}

interface ContributionBoundaryProps {
  readonly resetKey: string
  readonly fallback: ReactNode
  readonly onError?: (error: Error) => void
  readonly children: ReactNode
}

interface ContributionBoundaryState {
  readonly failedKey: string | null
}

class ContributionErrorBoundary extends Component<
  ContributionBoundaryProps,
  ContributionBoundaryState
> {
  state: ContributionBoundaryState = { failedKey: null }

  static getDerivedStateFromError(): Partial<ContributionBoundaryState> {
    return { failedKey: "__failed__" }
  }

  static getDerivedStateFromProps(
    props: ContributionBoundaryProps,
    state: ContributionBoundaryState
  ): Partial<ContributionBoundaryState> | null {
    if (
      state.failedKey !== null &&
      state.failedKey !== "__failed__" &&
      state.failedKey !== props.resetKey
    ) {
      return { failedKey: null }
    }
    return null
  }

  componentDidCatch(error: Error): void {
    this.setState({ failedKey: this.props.resetKey })
    this.props.onError?.(error)
  }

  render(): ReactNode {
    if (this.state.failedKey === "__failed__" || this.state.failedKey === this.props.resetKey) {
      return this.props.fallback
    }
    return this.props.children
  }
}

function ContributionBody<Owner extends object>({
  entry,
  owner,
  slots,
  i18n,
}: {
  readonly entry: RenderableContribution
  readonly owner?: Owner
  readonly slots?: PluginSlotRegistryService
  readonly i18n?: PluginI18nRegistryService
}): ReactNode {
  const hasChildrenSpec = Boolean(entry.children && Object.keys(entry.children).length > 0)
  const slotsSnapshot = useObservable(
    hasChildrenSpec && slots ? slots.state : STATIC_EMPTY_SLOTS_SOURCE
  )
  const locale = useObservable(i18n ? i18n.locale : STATIC_LOCALE_SOURCE)

  const i18nRevisionSource = useMemo<ObservableSource<number>>(
    () =>
      i18n
        ? {
            getSnapshot: i18n.getSnapshot,
            subscribe: i18n.subscribe,
          }
        : STATIC_ZERO_SOURCE,
    [i18n]
  )
  const i18nRevision = useObservable(i18nRevisionSource)

  const t = useMemo(() => {
    void i18nRevision
    return (key: string, params?: Readonly<Record<string, string | number>>): string => {
      const mutableParams = params ? ({ ...params } as Record<string, string | number>) : undefined
      if (isDefinedDictionary(entry.dictionary)) {
        const primary = locale === "en" ? entry.dictionary.en : entry.dictionary.zh
        const fallback = locale === "en" ? entry.dictionary.zh : entry.dictionary.en
        const resolved =
          resolveDictionaryMessage(primary, key, params) ??
          resolveDictionaryMessage(fallback, key, params)
        if (resolved !== undefined) return resolved
      } else if (isDictionaryMessages(entry.dictionary)) {
        const resolved = resolveDictionaryMessage(entry.dictionary, key, params)
        if (resolved !== undefined) return resolved
      }
      if (i18n) {
        return i18n.translate(entry.pluginId, key, locale, mutableParams)
      }
      return interpolateFallback(key, params)
    }
  }, [entry.dictionary, entry.pluginId, i18n, locale, i18nRevision])

  const { allowedNonChain, allowedChain } = useMemo(() => {
    const nonChain = new Set<string>()
    const chain = new Set<string>()
    for (const [slotName, childSpec] of Object.entries(entry.children ?? {})) {
      if (!childSpec) continue
      if (isChainSlotKind(childSpec.kind)) {
        chain.add(slotName)
      } else {
        nonChain.add(slotName)
      }
    }
    return { allowedNonChain: nonChain, allowedChain: chain }
  }, [entry.children])

  const renderSlot = useCallback(
    (
      slotName: SlotName,
      childOwner?: Record<string, unknown>,
      options?: RenderSlotOptions
    ): ReactNode => {
      if (allowedChain.has(slotName)) {
        throw new Error(
          `Slot "${slotName}" is a chain slot; "${entry.pluginId}" (${entry.id}) must use renderSlotChain`
        )
      }
      if (!allowedNonChain.has(slotName)) {
        throw new Error(
          `Contribution "${entry.pluginId}:${entry.id}" is not authorized to render slot "${slotName}"`
        )
      }
      if (!slots) {
        throw new Error(`Slot registry is unavailable while rendering slot "${slotName}"`)
      }
      void slotsSnapshot
      const isDeclared = slots.getSnapshot().declarations.some((decl) => decl.name === slotName)
      if (!isDeclared) {
        throw new Error(`Plugin slot is not declared: ${slotName}`)
      }
      const fallback = options?.fallback ?? null
      const matched = slots.select(slotName, options?.key)
      if (matched.length === 0) return fallback
      if (matched.length === 1) {
        const single = matched[0]!
        return (
          <ContributionOutlet
            key={`${single.pluginId}:${single.id}:${single.generation}`}
            entry={single}
            owner={childOwner}
            slots={slots}
            i18n={i18n}
            errorFallback={fallback}
          />
        )
      }
      return matched.map((item) => (
        <ContributionOutlet
          key={`${item.pluginId}:${item.id}:${item.generation}`}
          entry={item}
          owner={childOwner}
          slots={slots}
          i18n={i18n}
        />
      ))
    },
    [allowedChain, allowedNonChain, entry.id, entry.pluginId, i18n, slots, slotsSnapshot]
  )

  const renderSlotChain = useCallback(
    (slotName: SlotName, ...rest: unknown[]): ReactNode => {
      if (allowedNonChain.has(slotName)) {
        throw new Error(
          `Slot "${slotName}" is not a chain slot; "${entry.pluginId}" (${entry.id}) must use renderSlot`
        )
      }
      if (!allowedChain.has(slotName)) {
        throw new Error(
          `Contribution "${entry.pluginId}:${entry.id}" is not authorized to render chain slot "${slotName}"`
        )
      }
      if (!slots) {
        throw new Error(`Slot registry is unavailable while rendering chain slot "${slotName}"`)
      }
      void slotsSnapshot
      const isDeclared = slots.getSnapshot().declarations.some((decl) => decl.name === slotName)
      if (!isDeclared) {
        throw new Error(`Plugin slot is not declared: ${slotName}`)
      }

      let ownerFields: Record<string, unknown> = {}
      let innerChildren: ReactNode = null
      if (rest.length <= 1) {
        innerChildren = rest[0] as ReactNode
      } else {
        if (isPlainObject(rest[0])) {
          ownerFields = rest[0]
        }
        innerChildren = rest[1] as ReactNode
      }

      const matched = slots.select(slotName)
      if (matched.length === 0) return innerChildren

      return matched.reduceRight<ReactNode>((accumulated, item) => {
        const chainOwner = {
          ...ownerFields,
          children: accumulated,
        }
        return (
          <ContributionOutlet
            key={`${item.pluginId}:${item.id}:${item.generation}`}
            entry={item}
            owner={chainOwner}
            slots={slots}
            i18n={i18n}
            errorFallback={accumulated}
          />
        )
      }, innerChildren)
    },
    [allowedChain, allowedNonChain, entry.id, entry.pluginId, i18n, slots, slotsSnapshot]
  )

  const storeShare = useMemo<Record<string, unknown>>(() => {
    if (!isStoreInstance(entry.store)) return {}
    return {
      useStore: createObservableHook(entry.store.source),
      actions: entry.store.actions,
    }
  }, [entry.store])

  const injectShare = useMemo<Record<string, unknown>>(
    () => projectInjectResult(entry.inject),
    [entry.inject]
  )

  const synthesizedProps: Record<string, unknown> = {
    ...(owner ?? {}),
    locale,
    t,
    renderSlot,
    renderSlotChain,
    ...storeShare,
    ...injectShare,
  }

  const TargetComponent = entry.component as (props: Record<string, unknown>) => ReactNode
  return <TargetComponent {...synthesizedProps} />
}

export function ContributionOutlet<Owner extends object = Record<string, never>>({
  entry,
  owner,
  slots,
  i18n,
  errorFallback = null,
  onError,
}: ContributionOutletProps<Owner>): ReactNode {
  const resetKey = `${entry.pluginId}:${entry.id}:${entry.generation ?? 0}`
  return (
    <ContributionErrorBoundary resetKey={resetKey} fallback={errorFallback} onError={onError}>
      <ContributionBody key={resetKey} entry={entry} owner={owner} slots={slots} i18n={i18n} />
    </ContributionErrorBoundary>
  )
}

export interface KernelRecoveryProps {
  readonly title?: string
  readonly message?: string
  readonly reloadLabel?: string
  readonly onReload?: () => void
}

export function KernelRecovery({
  title = "应用界面未能加载",
  message = "没有可用的应用 Shell。请重新加载，或清除站点数据后重试。",
  reloadLabel = "重新加载",
  onReload,
}: KernelRecoveryProps): ReactNode {
  const handleReload = () => {
    if (onReload) {
      onReload()
      return
    }
    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload()
    }
  }

  return (
    <main
      data-kernel-recovery=""
      className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground"
    >
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        <button
          type="button"
          className="rounded-md border border-border px-4 py-2 text-sm"
          onClick={handleReload}
        >
          {reloadLabel}
        </button>
      </div>
    </main>
  )
}

function shellQualifiedKey(shell: PluginShellContribution): string {
  return `${shell.pluginId}:${shell.id}`
}

export interface ShellErrorBoundaryProps {
  readonly shell: PluginShellContribution
  readonly fallback?: PluginShellContribution
  readonly slots?: PluginSlotRegistryService
  readonly i18n?: PluginI18nRegistryService
  readonly selectShell: (id?: string) => void
  readonly onFailure?: (error: Error) => void
  readonly recoveryMessage?: string
  readonly children?: ReactNode
}

interface ShellErrorBoundaryState {
  readonly failedKey: string | null
}

export class ShellErrorBoundary extends Component<
  ShellErrorBoundaryProps,
  ShellErrorBoundaryState
> {
  state: ShellErrorBoundaryState = { failedKey: null }

  static getDerivedStateFromError(): Partial<ShellErrorBoundaryState> {
    return { failedKey: "__failed__" }
  }

  static getDerivedStateFromProps(
    props: ShellErrorBoundaryProps,
    state: ShellErrorBoundaryState
  ): Partial<ShellErrorBoundaryState> | null {
    const key = shellQualifiedKey(props.shell)
    if (state.failedKey !== null && state.failedKey !== "__failed__" && state.failedKey !== key) {
      return { failedKey: null }
    }
    return null
  }

  componentDidCatch(error: Error): void {
    this.setState({ failedKey: shellQualifiedKey(this.props.shell) })
    this.props.onFailure?.(error)
  }

  render(): ReactNode {
    const key = shellQualifiedKey(this.props.shell)
    if (this.state.failedKey === "__failed__" || this.state.failedKey === key) {
      if (!this.props.fallback) {
        return <KernelRecovery message={this.props.recoveryMessage} />
      }
      return (
        <ShellErrorBoundary
          key={shellQualifiedKey(this.props.fallback)}
          shell={this.props.fallback}
          slots={this.props.slots}
          i18n={this.props.i18n}
          selectShell={this.props.selectShell}
          recoveryMessage={this.props.recoveryMessage}
        >
          {this.props.children}
        </ShellErrorBoundary>
      )
    }

    return (
      <ContributionBody
        key={key}
        entry={this.props.shell}
        owner={{
          children: this.props.children,
          selectShell: this.props.selectShell,
        }}
        slots={this.props.slots}
        i18n={this.props.i18n}
      />
    )
  }
}

export interface OrahakoHostPreferencesLike {
  getActiveShell(): string | undefined
  setActiveShell(shellId: string | undefined): void
  getActiveTheme?(): string | undefined
}

export interface OrahakoHostLike {
  readonly composition: AppComposition
  readonly preferences?: OrahakoHostPreferencesLike
  readonly runtime?: {
    readonly state: ObservableSource<readonly unknown[]>
  }
  readonly ui?: PluginUIRegistryService
  readonly slots?: PluginSlotRegistryService
  readonly i18n?: PluginI18nRegistryService
  readonly bootstrapError?: string
}

export interface OrahakoAppProps {
  readonly host: OrahakoHostLike
  readonly children?: ReactNode
  readonly activeShell?: string
  readonly onSelectShell?: (shellId: string | undefined) => void
  readonly activeTheme?: string | null | ObservableSource<string | null | undefined>
}

export function OrahakoApp({
  host,
  children,
  activeShell: controlledShell,
  onSelectShell,
  activeTheme,
}: OrahakoAppProps): ReactNode {
  const runtimeStates = useObservable(host.runtime?.state ?? STATIC_EMPTY_ARRAY_SOURCE)
  void runtimeStates

  const slots = host.slots
  const ui = host.ui
  const i18n = host.i18n

  const slotsSnapshot = useObservable(slots ? slots.state : STATIC_EMPTY_SLOTS_SOURCE)
  const uiSnapshot = useObservable(ui ? ui.state : STATIC_EMPTY_UI_SOURCE)
  void slotsSnapshot

  const themeSource = isObservableSource<string | null | undefined>(activeTheme)
    ? activeTheme
    : STATIC_UNDEFINED_STRING_SOURCE
  const observedTheme = useObservable(themeSource)
  const effectiveThemeInput = isObservableSource(activeTheme) ? observedTheme : activeTheme

  const [preferenceTick, setPreferenceTick] = useState(0)
  const [memoryShell, setMemoryShell] = useState<string | undefined>(() =>
    host.preferences?.getActiveShell()
  )

  const selectShell = useCallback(
    (shellId?: string) => {
      host.preferences?.setActiveShell(shellId)
      setMemoryShell(shellId)
      setPreferenceTick((tick) => tick + 1)
      onSelectShell?.(shellId)
    },
    [host.preferences, onSelectShell]
  )

  void preferenceTick
  const preferredShellId =
    controlledShell !== undefined
      ? controlledShell
      : (host.preferences?.getActiveShell() ?? memoryShell)

  const activeThemeEntry = useMemo(() => {
    const themes = uiSnapshot.themes
    if (themes.length === 0) return undefined
    if (effectiveThemeInput === null || effectiveThemeInput === "") {
      return undefined
    }
    const requestedTheme = effectiveThemeInput ?? host.preferences?.getActiveTheme?.()
    if (requestedTheme !== undefined) {
      return themes.find(
        (item) => `${item.pluginId}:${item.id}` === requestedTheme || item.id === requestedTheme
      )
    }
    return themes.find((item) => item.css.trim().length > 0)
  }, [effectiveThemeInput, host.preferences, uiSnapshot.themes])

  const themeElement = activeThemeEntry ? (
    <style data-plugin-theme={`${activeThemeEntry.pluginId}:${activeThemeEntry.id}`}>
      {activeThemeEntry.css}
    </style>
  ) : null

  const rootContributions = slots ? slots.select("root") : []
  if (rootContributions.length > 0) {
    const rootEntry = rootContributions[0]!
    return (
      <Fragment>
        {themeElement}
        <ContributionOutlet
          key={`${rootEntry.pluginId}:${rootEntry.id}:${rootEntry.generation}`}
          entry={rootEntry}
          owner={{}}
          slots={slots}
          i18n={i18n}
          errorFallback={<KernelRecovery message={host.bootstrapError} />}
        />
      </Fragment>
    )
  }

  const shells = uiSnapshot.shells
  const defaultShell =
    shells.find((item) => shellQualifiedKey(item) === host.composition.defaults.shell) ?? shells[0]
  const selectedShell = preferredShellId
    ? shells.find(
        (item) => shellQualifiedKey(item) === preferredShellId || item.id === preferredShellId
      )
    : undefined
  const activeShellEntry = selectedShell ?? defaultShell

  if (!activeShellEntry) {
    return (
      <Fragment>
        {themeElement}
        <KernelRecovery message={host.bootstrapError} />
      </Fragment>
    )
  }

  const fallbackShell =
    selectedShell &&
    defaultShell &&
    shellQualifiedKey(selectedShell) !== shellQualifiedKey(defaultShell)
      ? defaultShell
      : undefined

  return (
    <Fragment>
      {themeElement}
      <ShellErrorBoundary
        key={shellQualifiedKey(activeShellEntry)}
        shell={activeShellEntry}
        fallback={fallbackShell}
        slots={slots}
        i18n={i18n}
        selectShell={selectShell}
        recoveryMessage={host.bootstrapError}
        onFailure={() => {
          if (preferredShellId) {
            selectShell(undefined)
          }
        }}
      >
        {children}
      </ShellErrorBoundary>
    </Fragment>
  )
}
