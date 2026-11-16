import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as JSXRuntime from "react/jsx-runtime"
import * as NextLink from "next/link"
import * as NextImage from "next/image"
import * as NextNavigation from "next/navigation"
import * as Sonner from "sonner"
import * as PluginSDK from "@orahako/plugin-sdk"
import * as Academic from "@orahako/academic"
import * as PluginComponents from "@orahako/plugin-ui/components"
import * as PluginHooks from "@orahako/plugin-ui/hooks"
import * as PluginStores from "@orahako/plugin-ui/stores"
import * as PluginAcademic from "@orahako/plugin-ui/academic"
import * as PluginPlatform from "@orahako/plugin-ui/platform"
import * as PluginRuntimeUI from "@orahako/plugin-ui/plugin"
import * as PluginShellRuntime from "@orahako/plugin-ui/shell"
import * as PluginAssets from "@orahako/plugin-ui/assets"
import type {
  AppComposition,
  CompositionPlugin,
  CompositionSource,
  MarketplaceIndex,
  MarketplaceRelease,
  PluginManifest,

  PluginNavigationService,
  PluginUIRegistryService,
  PluginSlotRegistryService,
  PluginNotificationService,
  PluginSettingsService,

  PluginI18nRegistryService,

  PluginNativeService,
} from "@orahako/plugin-sdk"
import {
  composeApplication,
  isCapacitor,
  selectCompatibleRelease,
} from "@orahako/plugin-sdk"
import semver from "semver"
import { PluginDependencyError, PluginRuntime } from "./runtime"
import { validateCompositionSource, validatePluginConfig } from "./config"
import {
  createHostModuleRegistry,
  loadExternalPlugin,
  type HostModuleRegistry,
  type LoadedExternalPlugin,
  SUPPORTED_HOST_MODULES,
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
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"

export class PluginHost {
  readonly packages: PluginPackageStore
  readonly runtime = new PluginRuntime()
  readonly appVersion: string
  readonly appBuild: string
  readonly composition: AppComposition
  readonly loadErrors = new Map<string, string>()
  recovery?: PluginRecoveryState
  bootstrapError?: string
  private bootstrapPromise?: Promise<void>
  private hostModules?: HostModuleRegistry
  private readonly external = new Map<string, LoadedExternalPlugin>()
  private readonly styleElements = new Map<string, HTMLStyleElement[]>()
  private readonly compositionPlugins: ReadonlyMap<string, CompositionPlugin>

  constructor(source: CompositionSource, packages = new PluginPackageStore()) {
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
    this.packages = packages
    this.runtime.context.set("packageRuntime", {
      installFromUrl: (url: string, sha256: string, expected: { id: string; version: string }) =>
        this.installFromUrl(url, sha256, expected),
      applyPluginBundle: (pluginIds: readonly string[], index: MarketplaceIndex) =>
        this.applyPluginBundle(pluginIds, index),
      assetUrl: (pluginId: string, path: string) => this.external.get(pluginId)?.assets.get(path),
      nativeCapabilities: () => this.composition.nativeCapabilities ?? [],
    })
    this.runtime.context.set("pluginManager", {
      enable: (id: string) => this.enable(id),
      suspend: (id: string) => this.suspend(id),
      disable: (id: string) => this.disable(id),
      isProtected: (id: string) =>
        this.composition.plugins.some((entry) => entry.id === id && entry.protected),
      isUserDisabled: (id: string) =>
        usePluginPreferences.getState().disabledPluginIds.includes(id),
      getSnapshot: () => this.runtime.getSnapshot(),
      subscribe: this.runtime.subscribe,
    })
    this.runtime.subscribe(() => {
      for (const id of Array.from(this.styleElements.keys())) {
        if (this.runtime.get(id)?.status !== "active") this.removeStyles(id)
      }
    })
  }

  get ui(): PluginUIRegistryService {
    return this.runtime.context.get("ui") as PluginUIRegistryService
  }

  get slots(): PluginSlotRegistryService {
    return this.runtime.context.get("slots") as PluginSlotRegistryService
  }

  get notifications(): PluginNotificationService {
    return this.runtime.context.get("notifications") as PluginNotificationService
  }

  get settings(): PluginSettingsService {
    return this.runtime.context.get("settings") as PluginSettingsService
  }

  get i18n(): PluginI18nRegistryService {
    return this.runtime.context.get("i18n") as PluginI18nRegistryService
  }


  get navigation(): PluginNavigationService {
    return this.runtime.context.get("navigation") as PluginNavigationService
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
    const previousSnapshot = await this.packages.read(manifest.id)
    const wasDisabled = usePluginPreferences.getState().disabledPluginIds.includes(manifest.id)
    const snapshot = await this.packages.install(bytes)
    usePluginPreferences.getState().setPluginDisabled(snapshot.manifest.id, false)
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

  /**
   * Installs and enables every plugin in a recommended bundle.
   *
   * All ids are resolved against the runtime, the local package store, and the
   * market index before anything changes, so an unsupported or unavailable
   * plugin cannot leave a partially applied bundle behind.
   */
  async applyPluginBundle(
    pluginIds: readonly string[],
    index: MarketplaceIndex
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
        // Preflight found a saved package; enable() clears its disabled preference.
        await this.enable(id)
        continue
      }
      await this.installFromUrl(
        new URL(release.zipUrl, this.requireMarketUrl()).toString(),
        release.sha256,
        { id, version: release.version }
      )
    }
    const manifest = this.runtime.get(pluginIds[0])?.manifest
    if (!manifest) throw new Error(`Plugin was not installed: ${pluginIds[0]}`)
    return manifest
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

  private requireMarketUrl(): string {
    const url = this.composition.market?.indexUrl
    if (!url) throw new Error("The active composition does not provide a plugin market")
    return url
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
        const installedVersion =
          this.runtime.get(dependency)?.manifest.version ?? installed.get(dependency)?.version
        if (installedVersion && !semver.satisfies(installedVersion, range)) {
          throw new Error(
            `Plugin dependency ${dependency}@${installedVersion} does not satisfy ${range}`
          )
        }
        visit(dependency)
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

  async uninstall(id: string): Promise<void> {
    const snapshot = await this.packages.read(id)
    if (!snapshot) throw new Error(`External plugin not found: ${id}`)
    if (this.runtime.get(id)?.source === "external") {
      this.runtime.stop(id)
      this.runtime.unregister(id)
    }
    this.external.get(id)?.dispose()
    this.external.delete(id)

    this.removeStyles(id)
    this.loadErrors.delete(id)
    const preferences = usePluginPreferences.getState()
    preferences.setPluginDisabled(id, false)
    if (preferences.activeShell?.startsWith(`${id}:`)) preferences.setActiveShell(undefined)
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
    usePluginPreferences.getState().setPluginDisabled(id, true)
  }

  async enable(id: string): Promise<void> {
    const state = this.runtime.get(id)
    // Disabled external packages are deliberately not registered at boot.
    // Register without starting so enable() owns the single start and style pass.
    if (!state || (state.source === "external" && !this.external.has(id))) {
      await this.load(id, false, false)
    }
    markPluginStarted(id)
    await this.runtime.startAndWait(id)
    this.applyStyles(id)
    usePluginPreferences.getState().setPluginDisabled(id, false)
  }

  private async rollback(
    id: string,
    previous: PluginPackageSnapshot | undefined,
    wasDisabled: boolean
  ): Promise<void> {
    usePluginPreferences.getState().setPluginDisabled(id, wasDisabled)
    if (this.runtime.get(id)) this.runtime.unregister(id)
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

  private async bootstrapAll(): Promise<void> {

    this.recovery = beginPluginBoot(this.appBuild)
    const pending = new Set<string>()
    for (const entry of this.composition.plugins) {
      const plugin = this.compositionPlugins.get(entry.id)
      if (!plugin) throw new Error(`Composition module is not available: ${entry.id}`)
      if (!this.runtime.get(entry.id)) {
        this.runtime.register(
          plugin.manifest,
          plugin.definition,
          "builtin",
          validatePluginConfig(plugin.manifest, entry.config)
        )
      }
      const disabled =
        entry.disabled ||
        usePluginPreferences.getState().disabledPluginIds.includes(plugin.manifest.id)
      if (disabled) this.runtime.stop(plugin.manifest.id)
      else pending.add(entry.id)
    }
    await this.startPending(pending)
    this.validateNativeCapabilityProfile()

    if (!this.recovery.safeMode) {
      try {
        await this.loadInstalled()

      } catch (error) {
        this.bootstrapError = errorMessage(error)
      }
    }

    window.setTimeout(finishPluginBoot, 2000)
  }

  private async startPending(input: ReadonlySet<string>): Promise<void> {
    const pending = new Set(input)
    while (pending.size > 0) {
      let progressed = false
      for (const id of Array.from(pending)) {
        try {

          markPluginStarted(id)
          await this.runtime.startAndWait(id)

          this.applyStyles(id)
          pending.delete(id)
          progressed = true
        } catch (error) {

          if (error instanceof PluginDependencyError) continue
          pending.delete(id)
          progressed = true
          this.loadErrors.set(id, errorMessage(error))
        }
      }
      if (!progressed) {
        for (const id of pending) {
          this.loadErrors.set(id, "Plugin dependencies could not be satisfied")
        }
        return
      }
    }
  }

  private async loadInstalled(): Promise<void> {
    const installed = await this.packages.list()
    const enabled = installed.filter(
      (summary) => !usePluginPreferences.getState().disabledPluginIds.includes(summary.manifest.id)
    )
    const pending = new Set<string>()
    for (const summary of enabled) {
      try {
        await this.load(summary.manifest.id, false, false)
        pending.add(summary.manifest.id)
      } catch (error) {
        this.loadErrors.set(summary.manifest.id, errorMessage(error))
      }
    }
    await this.startPending(pending)
  }

  private async load(id: string, replaceActive: boolean, start = true): Promise<void> {
    this.loadErrors.delete(id)
    const snapshot = await this.packages.read(id)
    if (!snapshot) throw new Error(`Installed plugin not found: ${id}`)
    if (this.runtime.get(id)?.source === "builtin") {
      throw new Error(`External plugin cannot shadow a composition module: ${id}`)
    }
    const loaded = await loadExternalPlugin(snapshot, {
      hostModules: this.getHostModules(),
    })
    const previous = this.external.get(id)
    const shouldStart = start && (replaceActive || !previous)
    this.external.set(id, loaded)
    this.removeStyles(id)
    try {
      this.runtime.register(
        loaded.manifest,
        loaded.definition,
        "external",
        validatePluginConfig(loaded.manifest)
      )
      if (shouldStart) {
        markPluginStarted(id)
        await this.runtime.startAndWait(id)
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

  private getHostModules(): HostModuleRegistry {
    if (!this.hostModules) {
      const modules: Record<string, object> = {
        react: React,
        "react-dom": ReactDOM,
        "react-dom/client": ReactDOMClient,
        "react/jsx-runtime": JSXRuntime,
        "next/link": typeof NextLink === "function" ? { default: NextLink } : NextLink,
        "next/image": typeof NextImage === "function" ? { default: NextImage } : NextImage,
        "next/navigation": NextNavigation,
        sonner: Sonner,
        "@orahako/academic": Academic,
        "@orahako/plugin-ui/components": PluginComponents,
        "@orahako/plugin-ui/hooks": PluginHooks,
        "@orahako/plugin-ui/stores": PluginStores,
        "@orahako/plugin-ui/academic": PluginAcademic,
        "@orahako/plugin-ui/platform": PluginPlatform,
        "@orahako/plugin-ui/plugin": PluginRuntimeUI,
        "@orahako/plugin-ui/shell": PluginShellRuntime,
        "@orahako/plugin-ui/assets": PluginAssets,
      }
      for (const specifier of SUPPORTED_HOST_MODULES) {
        if (specifier.startsWith("@orahako/plugin-sdk")) modules[specifier] = PluginSDK
      }
      this.hostModules = createHostModuleRegistry(modules)
    }
    return this.hostModules
  }

  private applyStyles(id: string): void {
    if (this.styleElements.has(id)) return
    const loaded = this.external.get(id)
    if (!loaded) return
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

let host: PluginHost | undefined

export function getPluginHost(source?: CompositionSource): PluginHost {
  if (!host) {
    if (!source) throw new Error("An application composition is required to create the plugin host")
    host = new PluginHost(source)
  }
  return host
}
