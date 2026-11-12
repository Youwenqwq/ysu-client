import { init as initializeLexer, parse as parseModule } from "es-module-lexer"
import type { Import as LexerImport } from "es-module-lexer"
import type { PluginDefinition, PluginManifest } from "@ysu/plugin-sdk"
import type { PluginPackage, PluginPackageFile } from "./plugin-package"
import { PLUGIN_MANIFEST_PATH } from "./plugin-package"
import {
  isJavaScriptPackagePath,
  isSafePackagePath,
  resolveRelativePackagePath,
} from "./package-path"

/** Bare imports served by the host bundle, sharing the host module instances. */
export { SUPPORTED_HOST_MODULES } from "@ysu/plugin-sdk/host-modules"

const HOST_MODULES_GLOBAL = "ysu.plugin.host-modules"
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css",
  ".gif": "image/gif",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

export type ExternalPluginErrorCode =
  | "module"
  | "unsupported-import"
  | "missing-import"
  | "cyclic-import"
  | "encoding"
  | "invalid-entry"
  | "missing-style"

export class ExternalPluginError extends Error {
  constructor(
    readonly code: ExternalPluginErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "ExternalPluginError"
  }
}

/** Object URL operations, injectable so loader logic is testable in Node. */
export interface BlobUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export const browserBlobUrlApi: BlobUrlApi = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
}

export interface HostModuleRegistry {
  resolve(specifier: string): string | undefined
  dispose(): void
}

export interface ModuleImportReference {
  specifier: string
  /** Start of the replaced source range (specifier contents, or the dynamic expression). */
  start: number
  /** End of the replaced source range. */
  end: number
  /** Dynamic imports expose the whole argument expression, including its quotes. */
  dynamic: boolean
}

export interface ModuleImportRewrite {
  reference: ModuleImportReference
  url: string
}

export interface ExternalPluginStyle {
  path: string
  text: string
}

export interface LoadedExternalPlugin {
  manifest: PluginManifest
  definition: PluginDefinition
  styles: readonly ExternalPluginStyle[]
  /** Blob URLs for package assets (icon, images, fonts, …). Revoked by dispose(). */
  assets: ReadonlyMap<string, string>
  dispose(): void
}

export interface ExternalPluginLoadOptions {
  /** Host module registry, or a plain map of bare specifier to existing Blob URL. */
  hostModules?: HostModuleRegistry | Readonly<Record<string, string>>
  blobUrls?: BlobUrlApi
  /** Seam for tests and non-browser hosts; defaults to native dynamic import. */
  importModule?: (url: string) => Promise<unknown>
}

let lexerReady: Promise<void> | undefined
let hostRegistrySequence = 0

/**
 * Build Blob modules that re-export host module instances. Plugins importing
 * "react" (or another supported specifier) share the exact host namespace.
 */
export function createHostModuleRegistry(
  namespaces: Readonly<Record<string, object>>,
  blobUrls: BlobUrlApi = browserBlobUrlApi
): HostModuleRegistry {
  const globalStore = hostModuleStore()
  const registryId = `host-${++hostRegistrySequence}-${Date.now().toString(36)}`
  const registry = new Map<string, object>()
  const urls = new Map<string, string>()
  const created: string[] = []
  globalStore.set(registryId, registry)

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const url of created) blobUrls.revokeObjectURL(url)
    urls.clear()
    registry.clear()
    globalStore.delete(registryId)
    if (globalStore.size === 0) deleteHostModuleStore()
  }

  try {
    for (const [specifier, namespace] of Object.entries(namespaces)) {
      if (!namespace || typeof namespace !== "object") {
        throw new TypeError(`Host module ${specifier} must be a module namespace object`)
      }
      registry.set(specifier, namespace)
      const source = hostModuleSource(registryId, specifier, namespace)
      const url = blobUrls.createObjectURL(new Blob([source], { type: "text/javascript" }))
      urls.set(specifier, url)
      created.push(url)
    }
  } catch (error) {
    dispose()
    throw error
  }

  return {
    resolve: (specifier) => urls.get(specifier),
    dispose,
  }
}

/** Parse module import specifiers and their source offsets. */
export async function analyzeModuleImports(
  source: string,
  name?: string
): Promise<readonly ModuleImportReference[]> {
  lexerReady ??= initializeLexer()
  await lexerReady

  let imports: readonly LexerImport[]
  try {
    const parsed = parseModule(source, name)
    imports = parsed[0]
  } catch (error) {
    throw new ExternalPluginError(
      "module",
      `Failed to parse ${name ?? "plugin module"}: ${errorMessage(error)}`,
      { cause: error }
    )
  }

  const references: ModuleImportReference[] = []
  for (const item of imports) {
    if (item.type === "import-meta") continue
    if (item.type === "dynamic") {
      if (!item.specifier || item.glob || item.probablyTypeOnly) continue
      references.push({
        specifier: item.specifier,
        start: item.start,
        end: item.end,
        dynamic: true,
      })
      continue
    }
    if (item.typeOnly || !item.specifier) continue
    references.push({
      specifier: item.specifier,
      start: item.start,
      end: item.end,
      dynamic: false,
    })
  }
  return references
}

/** Apply resolved URLs to all analyzable import specifiers. */
export function applyModuleImportRewrites(
  source: string,
  rewrites: readonly ModuleImportRewrite[]
): string {
  const ordered = [...rewrites].sort((a, b) => b.reference.start - a.reference.start)
  let output = source
  for (const { reference, url } of ordered) {
    const replacement = reference.dynamic ? JSON.stringify(url) : url
    output = output.slice(0, reference.start) + replacement + output.slice(reference.end)
  }
  return output
}

/**
 * Load a validated external plugin package as an ES module graph and return
 * its PluginDefinition plus style text and asset URLs.
 *
 * The caller owns the returned object: call dispose() when unloading to revoke
 * every module and asset object URL created for this load.
 */
export async function loadExternalPlugin(
  pkg: PluginPackage,
  options: ExternalPluginLoadOptions = {}
): Promise<LoadedExternalPlugin> {
  const blobUrls = options.blobUrls ?? browserBlobUrlApi
  const importModule = options.importModule ?? defaultImportModule
  const resolveHostModule = normalizeHostModules(options.hostModules)

  const files = new Map(pkg.files.map((file) => [file.path, file]))
  const stylePaths = new Set(pkg.manifest.styles ?? [])
  const createdUrls: string[] = []
  const moduleUrls = new Map<string, string>()
  const assetUrls = new Map<string, string>()
  const moduleSources = new Map<string, string>()
  const moduleImports = new Map<string, readonly ModuleImportReference[]>()
  const relativeTargets = new Map<string, Map<string, string>>()

  const revokeCreated = () => {
    for (const url of createdUrls) blobUrls.revokeObjectURL(url)
    createdUrls.length = 0
    moduleUrls.clear()
    assetUrls.clear()
  }

  try {
    const entry = pkg.manifest.entry
    const queued = new Set([entry])
    const queue = [entry]

    for (let index = 0; index < queue.length; index += 1) {
      const path = queue[index]
      if (moduleSources.has(path)) continue

      const file = files.get(path)
      if (!file) {
        throw new ExternalPluginError("missing-import", `Plugin entry is missing: ${path}`)
      }

      const source = decodeText(file.data, `plugin module ${path}`)
      const imports = await analyzeModuleImports(source, path)
      moduleSources.set(path, source)
      moduleImports.set(path, imports)

      const targets = new Map<string, string>()
      relativeTargets.set(path, targets)
      for (const reference of imports) {
        if (!reference.specifier.startsWith("./") && !reference.specifier.startsWith("../")) {
          if (!resolveHostModule(reference.specifier)) {
            throw new ExternalPluginError(
              "unsupported-import",
              `Unsupported import "${reference.specifier}" in ${path}`
            )
          }
          continue
        }

        const target = resolveModuleTarget(path, reference.specifier, files)
        targets.set(reference.specifier, target)
        if (!queued.has(target)) {
          queued.add(target)
          queue.push(target)
        }
      }
    }

    const state = new Map<string, "visiting" | "visited">()
    const order: string[] = []
    const visit = (path: string) => {
      const current = state.get(path)
      if (current === "visited") return
      if (current === "visiting") {
        throw new ExternalPluginError("cyclic-import", `Cyclic plugin import involving ${path}`)
      }
      state.set(path, "visiting")
      for (const target of new Set(relativeTargets.get(path)?.values() ?? [])) {
        visit(target)
      }
      state.set(path, "visited")
      order.push(path)
    }
    visit(entry)

    for (const path of order) {
      const source = moduleSources.get(path)
      const imports = moduleImports.get(path)
      if (source === undefined || !imports) {
        throw new ExternalPluginError("module", `Plugin module was not parsed: ${path}`)
      }

      const targets = relativeTargets.get(path)
      const rewrites: ModuleImportRewrite[] = []
      for (const reference of imports) {
        const isRelative =
          reference.specifier.startsWith("./") || reference.specifier.startsWith("../")
        const target = isRelative ? targets?.get(reference.specifier) : undefined
        const resolved = target ? moduleUrls.get(target) : resolveHostModule(reference.specifier)
        if (!resolved) {
          throw new ExternalPluginError(
            "missing-import",
            `Import "${reference.specifier}" in ${path} has no module URL`
          )
        }
        rewrites.push({ reference, url: resolved })
      }

      const code = applyModuleImportRewrites(source, rewrites)
      const url = blobUrls.createObjectURL(new Blob([code], { type: "text/javascript" }))
      moduleUrls.set(path, url)
      createdUrls.push(url)
    }

    const styles: ExternalPluginStyle[] = []
    for (const path of pkg.manifest.styles ?? []) {
      const file = files.get(path)
      if (!file) {
        throw new ExternalPluginError("missing-style", `Plugin stylesheet is missing: ${path}`)
      }
      styles.push({ path, text: decodeText(file.data, `plugin stylesheet ${path}`) })
    }

    for (const file of pkg.files) {
      if (
        file.path === PLUGIN_MANIFEST_PATH ||
        stylePaths.has(file.path) ||
        moduleSources.has(file.path) ||
        isJavaScriptPackagePath(file.path)
      ) {
        continue
      }
      const url = blobUrls.createObjectURL(
        new Blob([copyBlobPart(file.data)], { type: contentTypeForPath(file.path) })
      )
      assetUrls.set(file.path, url)
      createdUrls.push(url)
    }

    const entryUrl = moduleUrls.get(entry)
    if (!entryUrl) {
      throw new ExternalPluginError("module", `Plugin entry was not bundled: ${entry}`)
    }

    let namespace: unknown
    try {
      namespace = await importModule(entryUrl)
    } catch (error) {
      throw new ExternalPluginError(
        "invalid-entry",
        `Failed to import plugin entry ${entry}: ${errorMessage(error)}`,
        { cause: error }
      )
    }

    const definition =
      namespace && typeof namespace === "object" && "default" in namespace
        ? namespace.default
        : undefined
    if (!isPluginDefinition(definition)) {
      throw new ExternalPluginError(
        "invalid-entry",
        `Plugin entry ${entry} must default-export a PluginDefinition`
      )
    }

    let disposed = false
    return {
      manifest: pkg.manifest,
      definition,
      styles,
      assets: assetUrls,
      dispose() {
        if (disposed) return
        disposed = true
        revokeCreated()
      },
    }
  } catch (error) {
    revokeCreated()
    throw error
  }
}

function normalizeHostModules(
  source: ExternalPluginLoadOptions["hostModules"]
): (specifier: string) => string | undefined {
  if (!source) return () => undefined
  if ("resolve" in source) {
    const resolve = source.resolve
    if (typeof resolve === "function") return (specifier) => resolve(specifier)
  }
  // The non-registry branch is the documented plain specifier-to-URL map.
  const modules = source as Readonly<Record<string, string>>
  return (specifier) => modules[specifier]
}

function resolveModuleTarget(
  fromPath: string,
  specifier: string,
  files: ReadonlyMap<string, PluginPackageFile>
): string {
  const resolved = resolveRelativePackagePath(fromPath, specifier)
  if (!resolved) {
    throw new ExternalPluginError(
      "missing-import",
      `Import "${specifier}" from ${fromPath} escapes the plugin package`
    )
  }

  const candidates = [
    resolved,
    `${resolved}.js`,
    `${resolved}.mjs`,
    `${resolved}/index.js`,
    `${resolved}/index.mjs`,
  ]
  for (const candidate of candidates) {
    if (
      files.has(candidate) &&
      isSafePackagePath(candidate) &&
      isJavaScriptPackagePath(candidate)
    ) {
      return candidate
    }
  }

  throw new ExternalPluginError(
    "missing-import",
    `Import "${specifier}" from ${fromPath} does not resolve to a JavaScript package file`
  )
}

function decodeText(data: Uint8Array, label: string): string {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch (error) {
    throw new ExternalPluginError("encoding", `${label} is not valid UTF-8`, { cause: error })
  }
}

function copyBlobPart(data: Uint8Array): ArrayBuffer {
  return new Uint8Array(data).buffer
}

function contentTypeForPath(path: string): string {
  const dot = path.lastIndexOf(".")
  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream"
}

function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (typeof value === "function") return true
  if (!value || typeof value !== "object" || !("apply" in value)) return false
  return typeof value.apply === "function"
}

function hostModuleSource(registryId: string, specifier: string, namespace: object): string {
  const lines = [
    `const host = globalThis[Symbol.for(${JSON.stringify(HOST_MODULES_GLOBAL)})]` +
      `.get(${JSON.stringify(registryId)}).get(${JSON.stringify(specifier)})`,
  ]
  for (const name of Object.keys(namespace)) {
    if (name === "default" || !IDENTIFIER_PATTERN.test(name)) continue
    lines.push(`export const ${name} = host[${JSON.stringify(name)}]`)
  }
  if (Object.prototype.hasOwnProperty.call(namespace, "default")) {
    lines.push(`export default host["default"]`)
  }
  return `${lines.join("\n")}\n`
}

function hostModuleStore(): Map<string, Map<string, object>> {
  const globals = globalThis as unknown as Record<symbol, unknown>
  const key = Symbol.for(HOST_MODULES_GLOBAL)
  const existing = globals[key]
  if (existing instanceof Map) return existing as Map<string, Map<string, object>>
  const created = new Map<string, Map<string, object>>()
  globals[key] = created
  return created
}

function deleteHostModuleStore(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[Symbol.for(HOST_MODULES_GLOBAL)]
}

function defaultImportModule(url: string): Promise<unknown> {
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ /* @vite-ignore */ url)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
