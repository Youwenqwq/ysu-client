import semver from "semver"
import {
  composeApplication,
  createObservableSource,
  isCapacitor,
  selectCompatibleRelease,
  validatePluginManifest,
  type AppComposition,
  type CompositionPlugin,
  type CompositionSource,
  type MarketplaceIndex,
  type MarketplaceRelease,
  type PluginHostPreferences,
  type PluginHostPreferenceSnapshot,
  type PluginI18nRegistryService,
  type PluginManifest,
  type PluginNativeService,
  type PluginNavigationService,
  type PluginSettingsService,
  type PluginSlotRegistryService,
  type PluginUIRegistryService,
} from "@orahako/sdk"
import { validateCompositionSource, validatePluginConfig } from "./config"
import {
  createHostModuleRegistry,
  loadExternalPlugin,
  type HostModuleRegistry,
  type LoadedExternalPlugin,
} from "./external-loader"
import {
  PluginPackageStore,
  type PluginPackageInput,
  type PluginPackageSnapshot,
} from "./package-store"
import { parsePluginPackage } from "./plugin-package"
import {
  beginPluginBoot,
  finishPluginBoot,
  markPluginStarted,
  type PluginRecoveryState,
} from "./recovery"
import { PluginRuntime, type RuntimePluginExecutable } from "./runtime"

const DEFAULT_PREFERENCES_KEY = "orahako-plugin-preferences"

interface StoredHostPreferences {
  disabledPluginIds: string[]
  activeShell?: string
  activeTheme?: string
  startupPage?: string
}

export function createPluginHostPreferences(
  storageKey = DEFAULT_PREFERENCES_KEY
): PluginHostPreferences {
  let memoryDisabled = new Set<string>()
  let memoryActiveShell: string | undefined
  let memoryActiveTheme: string | undefined
  let memoryStartupPage: string | undefined

  const read = (): StoredHostPreferences => {
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(storageKey)
        if (raw) {
          const parsed: unknown = JSON.parse(raw)
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const disabled =
              "disabledPluginIds" in parsed && Array.isArray(parsed.disabledPluginIds)
                ? parsed.disabledPluginIds.filter((x): x is string => typeof x === "string")
                : []
            const activeShell =
              "activeShell" in parsed && typeof parsed.activeShell === "string"
                ? parsed.activeShell
                : undefined
            const activeTheme =
              "activeTheme" in parsed && typeof parsed.activeTheme === "string"
                ? parsed.activeTheme
                : undefined
            const startupPage =
              "startupPage" in parsed && typeof parsed.startupPage === "string"
                ? parsed.startupPage
                : undefined
            return {
              disabledPluginIds: disabled,
              ...(activeShell !== undefined ? { activeShell } : {}),
              ...(activeTheme !== undefined ? { activeTheme } : {}),
              ...(startupPage !== undefined ? { startupPage } : {}),
            }
          }
        }
      }
    } catch {
      // Fall back to in-memory state when localStorage is unavailable.
    }
    return {
      disabledPluginIds: Array.from(memoryDisabled),
      ...(memoryActiveShell !== undefined ? { activeShell: memoryActiveShell } : {}),
      ...(memoryActiveTheme !== undefined ? { activeTheme: memoryActiveTheme } : {}),
      ...(memoryStartupPage !== undefined ? { startupPage: memoryStartupPage } : {}),
    }
  }

  const write = (next: StoredHostPreferences): void => {
    memoryDisabled = new Set(next.disabledPluginIds)
    memoryActiveShell = next.activeShell
    memoryActiveTheme = next.activeTheme
    memoryStartupPage = next.startupPage
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(storageKey, JSON.stringify(next))
      }
    } catch {
      // In-memory state remains authoritative for this host instance.
    }
  }

  const snapshot = (preferences: StoredHostPreferences): PluginHostPreferenceSnapshot => ({
    ...(preferences.activeShell !== undefined ? { activeShell: preferences.activeShell } : {}),
    ...(preferences.activeTheme !== undefined ? { activeTheme: preferences.activeTheme } : {}),
    ...(preferences.startupPage !== undefined ? { startupPage: preferences.startupPage } : {}),
  })
  const stateSource = createObservableSource<PluginHostPreferenceSnapshot>(snapshot(read()))
  const commit = (next: StoredHostPreferences, publish: boolean): void => {
    write(next)
    if (publish) stateSource.set(snapshot(next))
  }

  return {
    state: {
      getSnapshot: stateSource.getSnapshot,
      subscribe: stateSource.subscribe,
    },
    isPluginDisabled(id: string): boolean {
      return read().disabledPluginIds.includes(id)
    },
    setPluginDisabled(id: string, disabled: boolean): void {
      const current = read()
      const nextIds = disabled
        ? Array.from(new Set([...current.disabledPluginIds, id]))
        : current.disabledPluginIds.filter((item) => item !== id)
      // Disabling only affects boot policy; the preference snapshot stays stable.
      commit({ ...current, disabledPluginIds: nextIds }, false)
    },
    getActiveShell(): string | undefined {
      return read().activeShell
    },
    setActiveShell(shellId: string | undefined): void {
      const current = read()
      commit(
        {
          disabledPluginIds: current.disabledPluginIds,
          ...(shellId !== undefined ? { activeShell: shellId } : {}),
          ...(current.activeTheme !== undefined ? { activeTheme: current.activeTheme } : {}),
          ...(current.startupPage !== undefined ? { startupPage: current.startupPage } : {}),
        },
        true
      )
    },
    getActiveTheme(): string | undefined {
      return read().activeTheme
    },
    setActiveTheme(themeId: string | undefined): void {
      const current = read()
      commit(
        {
          disabledPluginIds: current.disabledPluginIds,
          ...(current.activeShell !== undefined ? { activeShell: current.activeShell } : {}),
          ...(themeId !== undefined ? { activeTheme: themeId } : {}),
          ...(current.startupPage !== undefined ? { startupPage: current.startupPage } : {}),
        },
        true
      )
    },
    getStartupPage(): string | undefined {
      return read().startupPage
    },
    setStartupPage(startupPage: string | undefined): void {
      const current = read()
      commit(
        {
          disabledPluginIds: current.disabledPluginIds,
          ...(current.activeShell !== undefined ? { activeShell: current.activeShell } : {}),
          ...(current.activeTheme !== undefined ? { activeTheme: current.activeTheme } : {}),
          ...(startupPage !== undefined ? { startupPage } : {}),
        },
        true
      )
    },
  }
}

export interface PluginHostOptions {
  readonly platformModules: Readonly<Record<string, object>>
  readonly packages?: PluginPackageStore
  readonly preferences?: PluginHostPreferences
  readonly bootFinishDelayMs?: number
  readonly pluginStartTimeoutMs?: number
}

function toRuntimeExecutable(plugin: CompositionPlugin): RuntimePluginExecutable {
  if ("definition" in plugin) {
    return plugin.definition as RuntimePluginExecutable
  }
  return plugin
}

export class PluginHost {
  readonly packages: PluginPackageStore
  readonly preferences: PluginHostPreferences
  readonly runtime = new PluginRuntime()
  readonly appVersion: string
  readonly appBuild: string
  readonly composition: AppComposition
  readonly loadErrors = new Map<string, string>()
  recovery?: PluginRecoveryState
  bootstrapError?: string
  private bootstrapPromise?: Promise<void>
  private disposal?: Promise<void>
  private hostModules?: HostModuleRegistry
  private readonly platformModules: Readonly<Record<string, object>>
  private readonly bootFinishDelayMs: number
  private readonly pluginStartTimeoutMs: number
  private readonly external = new Map<string, LoadedExternalPlugin>()
  private readonly styleElements = new Map<string, HTMLStyleElement[]>()
  private readonly compositionPlugins: ReadonlyMap<string, CompositionPlugin>

  constructor(source: CompositionSource, options: PluginHostOptions = { platformModules: {} }) {
    this.appVersion = source.appVersion
    this.appBuild = source.appBuild
    this.composition = composeApplication(source.composition, source.layers)
    validateCompositionSource({
      appVersion: source.appVersion,
      appBuild: source.appBuild,
      composition: this.composition,
      plugins: source.plugins,
    })
    this.compositionPlugins = new Map(source.plugins.map((plugin) => [plugin.manifest.id, plugin]))
    this.platformModules = options.platformModules
    this.packages = options.packages ?? new PluginPackageStore()
    this.preferences = options.preferences ?? createPluginHostPreferences()
    this.bootFinishDelayMs = options.bootFinishDelayMs ?? 2000
    this.pluginStartTimeoutMs = options.pluginStartTimeoutMs ?? 10_000

    this.runtime.context.set("packageRuntime", {
      installFromUrl: (url: string, sha256: string, expected: { id: string; version: string }) =>
        this.installFromUrl(url, sha256, expected),
      applyPluginBundle: (
        pluginIds: readonly string[],
        index: MarketplaceIndex,
        marketBaseUrl: string
      ) => this.applyPluginBundle(pluginIds, index, marketBaseUrl),
      assetUrl: (pluginId: string, path: string) => this.external.get(pluginId)?.assets.get(path),
      nativeCapabilities: () => this.composition.nativeCapabilities ?? [],
      installPackage: (input: Uint8Array | ArrayBuffer | Blob) => this.install(input),
      uninstall: (id: string) => this.uninstall(id),
      listInstalled: () => this.packages.list(),
      marketUrl: () => this.composition.market?.indexUrl,
      appVersion: () => this.appVersion,
      loadErrors: () => this.loadErrors,
      preferenceState: this.preferences.state,
      getActiveShell: () => this.preferences.getActiveShell(),
      setActiveShell: (shellId: string | undefined) => this.preferences.setActiveShell(shellId),
      getActiveTheme: () => this.preferences.getActiveTheme(),
      setActiveTheme: (themeId: string | undefined) => this.preferences.setActiveTheme(themeId),
      getStartupPage: () => this.preferences.getStartupPage(),
      setStartupPage: (route: string | undefined) => this.preferences.setStartupPage(route),
      defaultLanding: () => this.composition.defaults.landing,
      defaultShell: () => this.composition.defaults.shell,
      safeMode: () => Boolean(this.recovery?.safeMode),
    })

    this.runtime.context.set("pluginManager", {
      state: this.runtime.state,
      enable: (id: string) => this.enable(id),
      suspend: (id: string) => this.suspend(id),
      disable: (id: string) => this.disable(id),
      isProtected: (id: string) =>
        this.composition.plugins.some((entry) => entry.id === id && entry.protected),
      isUserDisabled: (id: string) => this.preferences.isPluginDisabled(id),
      getSnapshot: () => this.runtime.getSnapshot(),
      subscribe: this.runtime.subscribe,
    })

    this.runtime.subscribe(() => {
      for (const id of this.external.keys()) {
        if (this.runtime.get(id)?.status === "active") {
          this.applyStyles(id)
        } else {
          this.removeStyles(id)
        }
      }
      for (const id of Array.from(this.styleElements.keys())) {
        if (this.runtime.get(id)?.status !== "active") {
          this.removeStyles(id)
        }
      }
    })
  }

  get ui(): PluginUIRegistryService | undefined {
    return this.runtime.context.get("ui") as PluginUIRegistryService | undefined
  }

  get slots(): PluginSlotRegistryService | undefined {
    return this.runtime.context.get("slots") as PluginSlotRegistryService | undefined
  }

  get settings(): PluginSettingsService | undefined {
    return this.runtime.context.get("settings")
  }

  get i18n(): PluginI18nRegistryService | undefined {
    return this.runtime.context.get("i18n") as PluginI18nRegistryService | undefined
  }

  get navigation(): PluginNavigationService | undefined {
    return this.runtime.context.get("navigation")
  }

  bootstrap(): Promise<void> {
    this.bootstrapPromise ??= this.bootstrapAll()
    return this.bootstrapPromise
  }

  async install(
    input: PluginPackageInput,
    expectedSha256?: string,
    expected?: { id: string; version: string }
  ): Promise<PluginManifest> {
    if (expectedSha256) await verifyPackageHash(input, expectedSha256)
    const bytes = await packageInputBytes(input)
    const manifest = parsePluginPackage(bytes).manifest
    const missingNativeCapabilities = (manifest.nativeCapabilities ?? []).filter(
      (capability) => !(this.composition.nativeCapabilities ?? []).includes(capability)
    )
    if (missingNativeCapabilities.length > 0) {
      throw new Error(
        `Plugin requires unavailable native capabilities: ${missingNativeCapabilities.join(", ")}`
      )
    }
    if (expected && (manifest.id !== expected.id || manifest.version !== expected.version)) {
      throw new Error("Plugin package identity does not match the market release")
    }
    if (
      this.compositionPlugins.has(manifest.id) ||
      this.runtime.get(manifest.id)?.source === "builtin"
    ) {
      throw new Error(`External plugin cannot shadow a composition module: ${manifest.id}`)
    }
    this.assertAppCompatible(manifest)
    const previousSnapshot = await this.packages.read(manifest.id)
    const wasDisabled = this.preferences.isPluginDisabled(manifest.id)
    const snapshot = await this.packages.install(bytes)
    this.preferences.setPluginDisabled(snapshot.manifest.id, false)
    try {
      await this.load(snapshot.manifest.id, true)
    } catch (error) {
      await this.rollback(snapshot.manifest.id, previousSnapshot, wasDisabled)
      this.loadErrors.set(snapshot.manifest.id, errorMessage(error))
      throw error
    }
    return snapshot.manifest
  }

  async installFromUrl(
    url: string,
    sha256: string,
    expected: { id: string; version: string }
  ): Promise<PluginManifest> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Plugin download returned HTTP ${response.status}`)
    return this.install(await response.arrayBuffer(), sha256, expected)
  }

  async applyPluginBundle(
    pluginIds: readonly string[],
    index: MarketplaceIndex,
    marketBaseUrl: string
  ): Promise<PluginManifest> {
    if (pluginIds.length === 0) throw new Error("Plugin bundle must not be empty")
    const { releases, ordered } = await this.preflightPluginBundle(pluginIds, index)
    for (const id of ordered) {
      const state = this.runtime.get(id)
      if (state?.status === "active" || state?.status === "starting") continue
      if (state) {
        await this.enable(id)
        continue
      }
      const release = releases.get(id)
      if (!release) {
        await this.enable(id)
        continue
      }
      await this.installFromUrl(
        new URL(release.zipUrl, marketBaseUrl).toString(),
        release.sha256,
        { id, version: release.version }
      )
    }
    const manifest = this.runtime.get(pluginIds[0]!)?.manifest
    if (!manifest) throw new Error(`Plugin was not installed: ${pluginIds[0]}`)
    return manifest
  }

  async uninstall(id: string): Promise<void> {
    const snapshot = await this.packages.read(id)
    if (!snapshot) throw new Error(`External plugin not found: ${id}`)
    const registeredRoutes = new Set<string>()
    for (const page of this.ui?.getSnapshot().pages ?? []) {
      if (page.pluginId === id && page.route !== undefined) registeredRoutes.add(page.route)
    }
    if (this.runtime.get(id)?.source === "external") {
      this.runtime.stop(id)
      this.runtime.unregister(id)
    }
    this.external.get(id)?.dispose()
    this.external.delete(id)

    this.removeStyles(id)
    this.loadErrors.delete(id)
    this.preferences.setPluginDisabled(id, false)
    if (this.preferences.getActiveShell()?.startsWith(`${id}:`)) {
      this.preferences.setActiveShell(undefined)
    }
    if (this.preferences.getActiveTheme()?.startsWith(`${id}:`)) {
      this.preferences.setActiveTheme(undefined)
    }
    const startupPage = this.preferences.getStartupPage()
    if (startupPage !== undefined && registeredRoutes.has(startupPage)) {
      this.preferences.setStartupPage(undefined)
    }
    await this.packages.remove(id)
  }

  suspend(id: string): void {
    this.runtime.stop(id)
    this.removeStyles(id)
  }

  disable(id: string): void {
    if (this.composition.plugins.some((entry) => entry.id === id && entry.protected)) {
      throw new Error(`Plugin is protected by the active composition: ${id}`)
    }
    this.runtime.stop(id)
    this.removeStyles(id)
    this.preferences.setPluginDisabled(id, true)
  }

  async enable(id: string): Promise<void> {
    const state = this.runtime.get(id)
    if (!state || (state.source === "external" && !this.external.has(id))) {
      await this.load(id, false, false)
    }
    markPluginStarted(id)
    await this.runtime.startAndWait(id)
    this.applyStyles(id)
    this.loadErrors.delete(id)
    this.preferences.setPluginDisabled(id, false)
  }

  getHostModules(): HostModuleRegistry {
    if (!this.hostModules) {
      this.hostModules = createHostModuleRegistry(this.platformModules)
    }
    return this.hostModules
  }

  dispose(): Promise<void> {
    this.disposal ??= this.disposeInternal()
    return this.disposal
  }

  private async disposeInternal(): Promise<void> {
    try {
      // Runtime scopes may own async native cleanup; finish it before the
      // plugin module and host-module URLs disappear.
      await this.runtime.dispose()
    } finally {
      try {
        for (const id of Array.from(this.styleElements.keys())) {
          this.removeStyles(id)
        }
        for (const loaded of this.external.values()) {
          loaded.dispose()
        }
        this.external.clear()
        this.hostModules?.dispose()
        this.hostModules = undefined
      } finally {
        this.packages.close()
      }
    }
  }

  private assertAppCompatible(manifest: PluginManifest): void {
    const minimum = manifest.minAppVersion
    if (minimum === undefined) return
    if (!semver.valid(this.appVersion)) {
      throw new Error(`Host app version is not valid SemVer: ${this.appVersion}`)
    }
    if (semver.lt(this.appVersion, minimum)) {
      throw new Error(
        `Plugin ${manifest.id}@${manifest.version} requires app ${minimum} or newer (current ${this.appVersion})`
      )
    }
  }

  private availableNativeCapabilities(): readonly string[] {
    const native = this.runtime.context.get("native") as PluginNativeService | undefined
    if (!native?.isNative) return []
    return native.capabilities.list().map((capability) => `${capability.id}@${capability.version}`)
  }

  private validateNativeCapabilityProfile(): void {
    const native = this.runtime.context.get("native") as PluginNativeService | undefined
    if (!native?.isNative) return
    const available = new Set(this.availableNativeCapabilities())
    const missing = (this.composition.nativeCapabilities ?? []).filter(
      (capability) => !available.has(capability)
    )
    if (missing.length > 0) {
      throw new Error(`Composition native capabilities are not implemented: ${missing.join(", ")}`)
    }
  }

  private async preflightPluginBundle(
    pluginIds: readonly string[],
    index: MarketplaceIndex
  ): Promise<{ releases: Map<string, MarketplaceRelease>; ordered: string[] }> {
    const installed = new Map<string, PluginManifest>()
    for (const summary of await this.packages.list()) {
      installed.set(summary.manifest.id, summary.manifest)
    }
    const platform = isCapacitor() ? "android" : "web"
    const releases = new Map<string, MarketplaceRelease>()
    const ordered: string[] = []
    const visiting = new Set<string>()
    const resolved = new Set<string>()

    const visit = (id: string): void => {
      if (resolved.has(id)) return
      if (visiting.has(id)) throw new Error(`Plugin dependency cycle detected: ${id}`)
      visiting.add(id)
      const manifest = this.runtime.get(id)?.manifest ?? installed.get(id)

      let release: MarketplaceRelease | undefined
      if (!manifest) {
        const plugin = index.plugins.find((entry) => entry.id === id)
        if (!plugin) throw new Error(`Plugin not found in market: ${id}`)
        release = selectCompatibleRelease(
          plugin,
          this.appVersion,
          platform,
          this.composition.nativeCapabilities ?? []
        )
        if (!release) {
          throw new Error(
            `No compatible release for plugin ${id} (app ${this.appVersion}, platform ${platform})`
          )
        }
      }
      for (const [dependency, range] of Object.entries(
        manifest?.requires ?? release?.requires ?? {}
      )) {
        visit(dependency)
        const dependencyVersion =
          this.runtime.get(dependency)?.manifest.version ??
          installed.get(dependency)?.version ??
          releases.get(dependency)?.version
        if (dependencyVersion && !semver.satisfies(dependencyVersion, range)) {
          throw new Error(
            `Plugin dependency ${dependency}@${dependencyVersion} does not satisfy ${range}`
          )
        }
      }
      for (const service of manifest?.inject ?? release?.inject ?? []) {
        if (this.runtime.context.get(service) != null) continue
        if ((manifest?.provides ?? release?.provides ?? []).includes(service)) continue
        const installedProvider = Array.from(installed.values()).find((candidate) =>
          candidate.provides?.includes(service)
        )
        if (installedProvider) {
          visit(installedProvider.id)
          continue
        }
        const compositionProvider = Array.from(this.compositionPlugins.values()).find((plugin) =>
          plugin.manifest.provides?.includes(service)
        )
        if (compositionProvider) {
          visit(compositionProvider.manifest.id)
          continue
        }
        const marketProvider = index.plugins.find((plugin) =>
          selectCompatibleRelease(
            plugin,
            this.appVersion,
            platform,
            this.composition.nativeCapabilities ?? []
          )?.provides?.includes(service)
        )
        if (!marketProvider) throw new Error(`No provider for required service ${service}: ${id}`)
        visit(marketProvider.id)
      }
      if (release) releases.set(id, release)
      visiting.delete(id)
      resolved.add(id)
      ordered.push(id)
    }

    for (const id of new Set(pluginIds)) visit(id)
    return { releases, ordered }
  }

  private async rollback(
    id: string,
    previous: PluginPackageSnapshot | undefined,
    wasDisabled: boolean
  ): Promise<void> {
    this.preferences.setPluginDisabled(id, wasDisabled)
    if (this.runtime.get(id)?.source === "external") this.runtime.unregister(id)
    this.external.get(id)?.dispose()
    this.external.delete(id)
    this.removeStyles(id)
    if (!previous) {
      await this.packages.remove(id)
      return
    }
    await this.packages.restore(previous)
    await this.load(id, true)
    if (wasDisabled) {
      this.runtime.stop(id)
      this.removeStyles(id)
    }
  }

  private orderByPackageRequires(ids: readonly string[]): string[] {
    const targetSet = new Set(ids)
    const ordered: string[] = []
    const visited = new Set<string>()
    const visiting = new Set<string>()

    const visit = (id: string) => {
      if (visited.has(id) || !targetSet.has(id)) return
      if (visiting.has(id)) return
      visiting.add(id)
      const manifest = this.runtime.get(id)?.manifest
      for (const dep of Object.keys(manifest?.requires ?? {})) {
        visit(dep)
      }
      visiting.delete(id)
      visited.add(id)
      ordered.push(id)
    }

    for (const id of ids) visit(id)
    return ordered
  }

  private async mountGroup(ids: readonly string[]): Promise<void> {
    const ordered = this.orderByPackageRequires(ids)
    const results = await Promise.allSettled(
      ordered.map(async (id) => {
        markPluginStarted(id)
        await this.runtime.startAndWait(id, this.pluginStartTimeoutMs)
      })
    )
    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        this.loadErrors.set(ordered[index]!, errorMessage(result.reason))
      }
    }
    for (const id of ordered) {
      if (this.loadErrors.has(id)) continue
      const state = this.runtime.get(id)
      if (!state) continue
      if (state.status === "failed") {
        this.loadErrors.set(id, state.error ?? `Plugin failed: ${id}`)
      } else if (state.status === "waiting") {
        const missing = this.runtime.missingServices(id)
        this.loadErrors.set(
          id,
          missing.length > 0
            ? `Missing required services: ${missing.join(", ")}`
            : "Plugin dependencies could not be satisfied"
        )
      }
    }
  }

  private async bootstrapAll(): Promise<void> {
    this.recovery = beginPluginBoot(this.appBuild)
    const enabledIds: string[] = []

    for (const entry of this.composition.plugins) {
      const plugin = this.compositionPlugins.get(entry.id)
      if (!plugin) throw new Error(`Composition module is not available: ${entry.id}`)
      if (!this.runtime.get(entry.id)) {
        const schema =
          "configSchema" in plugin && plugin.configSchema !== undefined
            ? plugin.configSchema
            : plugin.manifest.configSchema
        this.runtime.register(
          plugin.manifest,
          toRuntimeExecutable(plugin),
          "builtin",
          validatePluginConfig({ id: plugin.manifest.id, configSchema: schema }, entry.config)
        )
      }
      const disabled = entry.disabled || this.preferences.isPluginDisabled(plugin.manifest.id)
      if (disabled) this.runtime.stop(plugin.manifest.id)
      else enabledIds.push(entry.id)
    }

    await this.mountGroup(enabledIds)
    if (this.recovery.safeMode) {
      try {
        this.validateNativeCapabilityProfile()
      } catch (error) {
        this.bootstrapError = errorMessage(error)
      }
    } else {
      this.validateNativeCapabilityProfile()
    }

    if (!this.recovery.safeMode) {
      try {
        await this.loadInstalled()
      } catch (error) {
        this.bootstrapError = errorMessage(error)
      }
    }

    if (typeof globalThis.setTimeout === "function") {
      const handle: unknown = globalThis.setTimeout(finishPluginBoot, this.bootFinishDelayMs)
      if (typeof handle === "object" && handle !== null && "unref" in handle) {
        const unref = handle.unref
        if (typeof unref === "function") unref.call(handle)
      }
    }
  }

  private async loadInstalled(): Promise<void> {
    const installed = await this.packages.list()
    const enabled = installed.filter(
      (summary) => !this.preferences.isPluginDisabled(summary.manifest.id)
    )
    const loadedIds: string[] = []
    for (const summary of enabled) {
      try {
        await this.load(summary.manifest.id, false, false)
        loadedIds.push(summary.manifest.id)
      } catch (error) {
        this.loadErrors.set(summary.manifest.id, errorMessage(error))
      }
    }
    await this.mountGroup(loadedIds)
  }

  private async load(id: string, replaceActive: boolean, start = true): Promise<void> {
    this.loadErrors.delete(id)
    const snapshot = await this.packages.read(id)
    if (!snapshot) throw new Error(`Installed plugin not found: ${id}`)
    if (this.compositionPlugins.has(id) || this.runtime.get(id)?.source === "builtin") {
      throw new Error(`External plugin cannot shadow a composition module: ${id}`)
    }
    // Re-validate on every load so packages written for an older host API can
    // never bypass the current manifest contract after a host upgrade.
    const manifest = validatePluginManifest(snapshot.manifest)
    this.assertAppCompatible(manifest)
    const loaded = await loadExternalPlugin(snapshot, {
      hostModules: this.getHostModules(),
    })
    const previous = this.external.get(id)
    const shouldStart = start && (replaceActive || !previous)
    this.external.set(id, loaded)
    this.removeStyles(id)
    try {
      this.runtime.register(
        manifest,
        loaded.definition as RuntimePluginExecutable,
        "external",
        validatePluginConfig(manifest)
      )
      if (shouldStart) {
        markPluginStarted(id)
        await this.runtime.startAndWait(id, this.pluginStartTimeoutMs)
        this.applyStyles(id)
      }
    } catch (error) {
      if (previous) this.external.set(id, previous)
      else this.external.delete(id)
      loaded.dispose()
      throw error
    }
    this.loadErrors.delete(id)
    if (previous && previous !== loaded) previous.dispose()
  }

  private applyStyles(id: string): void {
    if (this.styleElements.has(id)) return
    if (typeof document === "undefined" || !document.head) return
    const loaded = this.external.get(id)
    if (!loaded || loaded.styles.length === 0) return
    const elements = loaded.styles.map((style) => {
      const element = document.createElement("style")
      element.dataset.pluginStyle = `${id}:${style.path}`
      element.textContent = style.text
      document.head.append(element)
      return element
    })
    this.styleElements.set(id, elements)
  }

  private removeStyles(id: string): void {
    for (const element of this.styleElements.get(id) ?? []) element.remove()
    this.styleElements.delete(id)
  }
}

async function packageInputBytes(input: PluginPackageInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(await input.arrayBuffer())
}

async function verifyPackageHash(input: PluginPackageInput, expected: string): Promise<void> {
  const bytes = await packageInputBytes(input)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer)
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  if (actual !== expected.toLowerCase()) throw new Error("Plugin package SHA-256 mismatch")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
