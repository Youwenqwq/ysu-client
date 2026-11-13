import * as React from "react"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as JSXRuntime from "react/jsx-runtime"
import * as NextLink from "next/link"
import * as NextImage from "next/image"
import * as NextNavigation from "next/navigation"
import * as PluginSDK from "@ysu/plugin-sdk"
import * as Academic from "@ysu/academic"
import * as PluginComponents from "@ysu/plugin-ui/components"
import * as PluginHooks from "@ysu/plugin-ui/hooks"
import * as PluginStores from "@ysu/plugin-ui/stores"
import * as PluginAcademic from "@ysu/plugin-ui/academic"
import * as PluginPlatform from "@ysu/plugin-ui/platform"
import * as PluginRuntimeUI from "@ysu/plugin-ui/plugin"
import * as PluginShellRuntime from "@ysu/plugin-ui/shell"
import * as PluginAssets from "@ysu/plugin-ui/assets"
import type { PluginManifest } from "@ysu/plugin-sdk"
import { OFFICIAL_PLUGINS } from "@/plugins/official/registry"
import { PluginRuntime } from "./runtime"
import { PluginUIRegistry } from "./ui-registry"
import { PluginSlotRegistry } from "./slot-registry"
import { PluginLifecycleRegistry } from "./lifecycle-service"
import { PluginI18nRegistry } from "./i18n-registry"
import { providerRegistry } from "@/providers/provider-registry"
import { createPluginStorageService } from "./storage-service"
import { createPluginPlatformServices } from "./platform-service"
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
  readonly ui = new PluginUIRegistry()
  readonly slots = new PluginSlotRegistry()
  readonly lifecycle = new PluginLifecycleRegistry()
  readonly i18n = new PluginI18nRegistry()
  readonly providers = providerRegistry
  readonly packages = new PluginPackageStore()
  readonly runtime = new PluginRuntime((ctx, manifest) => {
    this.ui.createService(ctx, manifest)
    this.slots.createService(ctx, manifest)
    this.lifecycle.createService(ctx, manifest)
    this.i18n.createService(ctx, manifest)
    this.providers.createService(ctx, manifest)
    createPluginStorageService(ctx, manifest)
    createPluginPlatformServices(ctx, manifest)
    ctx.set("assets", {
      url: (path: string) => this.external.get(manifest.id)?.assets.get(path),
    })
  })
  readonly loadErrors = new Map<string, string>()
  recovery?: PluginRecoveryState
  bootstrapError?: string
  private bootstrapPromise?: Promise<void>
  private hostModules?: HostModuleRegistry
  private readonly external = new Map<string, LoadedExternalPlugin>()
  private readonly styleElements = new Map<string, HTMLStyleElement[]>()

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

  disable(id: string): void {
    this.runtime.stop(id)
    this.removeStyles(id)
    usePluginPreferences.getState().setPluginDisabled(id, true)
  }

  async enable(id: string): Promise<void> {
    usePluginPreferences.getState().setPluginDisabled(id, false)
    const state = this.runtime.get(id)
    if (state?.source === "external" && !this.external.has(id)) await this.load(id, false)
    markPluginStarted(id)
    await this.runtime.startAndWait(id)
    this.applyStyles(id)
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
    this.recovery = beginPluginBoot()
    for (const plugin of OFFICIAL_PLUGINS) {
      if (!this.runtime.get(plugin.manifest.id)) {
        this.runtime.register(plugin.manifest, plugin.definition, "builtin")
      }
      const disabled = usePluginPreferences
        .getState()
        .disabledPluginIds.includes(plugin.manifest.id)
      if (disabled) this.runtime.stop(plugin.manifest.id)
      else if (this.runtime.get(plugin.manifest.id)?.status !== "active") {
        markPluginStarted(plugin.manifest.id)
        this.runtime.start(plugin.manifest.id)
      }
    }
    if (!this.recovery.safeMode) {
      try {
        await this.loadInstalled()
      } catch (error) {
        this.bootstrapError = errorMessage(error)
      }
    }
    window.setTimeout(finishPluginBoot, 2000)
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
    while (pending.size > 0) {
      let progressed = false
      for (const id of Array.from(pending)) {
        const state = this.runtime.get(id)
        if (state?.manifest.requires?.some((dependency) => pending.has(dependency))) continue
        pending.delete(id)
        progressed = true
        try {
          markPluginStarted(id)
          await this.runtime.startAndWait(id)
          this.applyStyles(id)
        } catch (error) {
          this.loadErrors.set(id, errorMessage(error))
        }
      }
      if (!progressed) {
        for (const id of pending) {
          try {
            await this.runtime.startAndWait(id)
          } catch (error) {
            this.loadErrors.set(id, errorMessage(error))
          }
        }
        pending.clear()
      }
    }
  }

  private async load(id: string, replaceActive: boolean, start = true): Promise<void> {
    this.loadErrors.delete(id)
    const snapshot = await this.packages.read(id)
    if (!snapshot) throw new Error(`Installed plugin not found: ${id}`)
    const loaded = await loadExternalPlugin(snapshot, {
      hostModules: this.getHostModules(),
    })
    const previous = this.external.get(id)
    const shouldStart = start && (replaceActive || !previous)
    this.external.set(id, loaded)
    this.removeStyles(id)
    try {
      this.runtime.register(loaded.manifest, loaded.definition, "external")
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
        "@ysu/academic": Academic,
        "@ysu/plugin-ui/components": PluginComponents,
        "@ysu/plugin-ui/hooks": PluginHooks,
        "@ysu/plugin-ui/stores": PluginStores,
        "@ysu/plugin-ui/academic": PluginAcademic,
        "@ysu/plugin-ui/platform": PluginPlatform,
        "@ysu/plugin-ui/plugin": PluginRuntimeUI,
        "@ysu/plugin-ui/shell": PluginShellRuntime,
        "@ysu/plugin-ui/assets": PluginAssets,
      }
      for (const specifier of SUPPORTED_HOST_MODULES) {
        if (specifier.startsWith("@ysu/plugin-sdk")) modules[specifier] = PluginSDK
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

export function getPluginHost(): PluginHost {
  host ??= new PluginHost()
  return host
}
