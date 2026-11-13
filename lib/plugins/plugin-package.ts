import { unzipSync } from "fflate"
import {
  PluginManifestError,
  validatePluginManifest,
  type PluginManifest,
} from "@orahako/plugin-sdk/manifest"
import { isSafePackagePath } from "./package-path.ts"

export const PLUGIN_MANIFEST_PATH = "manifest.json"

export interface PluginPackageLimits {
  /** Maximum compressed ZIP size accepted from the installer. */
  maxArchiveBytes: number
  /** Maximum uncompressed size of a single package file. */
  maxFileBytes: number
  /** Maximum total uncompressed size of the whole package. */
  maxTotalBytes: number
  /** Maximum number of files in the package. */
  maxFiles: number
  /** Maximum size of manifest.json. */
  maxManifestBytes: number
}

export const DEFAULT_PLUGIN_PACKAGE_LIMITS: PluginPackageLimits = {
  maxArchiveBytes: 20 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFiles: 512,
  maxManifestBytes: 64 * 1024,
}

export type PluginPackageErrorCode =
  | "archive"
  | "path"
  | "duplicate"
  | "limit"
  | "manifest"
  | "missing-file"
  | "encoding"

export class PluginPackageError extends Error {
  constructor(
    readonly code: PluginPackageErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "PluginPackageError"
  }
}

export interface PluginPackageFile {
  path: string
  data: Uint8Array
}

export interface PluginPackage {
  manifest: PluginManifest
  files: readonly PluginPackageFile[]
}

/** Find a file in a parsed package. */
export function pluginPackageFile(pkg: PluginPackage, path: string): PluginPackageFile | undefined {
  return pkg.files.find((file) => file.path === path)
}

/** Parse and fully validate an external plugin ZIP package. */
export function parsePluginPackage(
  input: Uint8Array | ArrayBuffer,
  limits: Partial<PluginPackageLimits> = {}
): PluginPackage {
  const effective = { ...DEFAULT_PLUGIN_PACKAGE_LIMITS, ...limits }
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input

  if (bytes.byteLength === 0) {
    throw new PluginPackageError("archive", "Plugin package is empty")
  }
  if (bytes.byteLength > effective.maxArchiveBytes) {
    throw new PluginPackageError(
      "limit",
      `Plugin archive exceeds ${effective.maxArchiveBytes} bytes`
    )
  }

  const seen = new Set<string>()
  let fileCount = 0
  let declaredTotal = 0

  let extracted: Record<string, Uint8Array>
  try {
    extracted = unzipSync(bytes, {
      filter(file) {
        // Explicit directory entries carry no content and are not part of the package.
        if (file.name.endsWith("/")) return false
        if (!isSafePackagePath(file.name)) {
          throw new PluginPackageError("path", `Unsafe package path: ${file.name}`)
        }
        if (seen.has(file.name)) {
          throw new PluginPackageError("duplicate", `Duplicate package file: ${file.name}`)
        }
        seen.add(file.name)

        fileCount += 1
        if (fileCount > effective.maxFiles) {
          throw new PluginPackageError(
            "limit",
            `Plugin package contains more than ${effective.maxFiles} files`
          )
        }
        if (file.originalSize > effective.maxFileBytes) {
          throw new PluginPackageError(
            "limit",
            `Package file ${file.name} exceeds ${effective.maxFileBytes} bytes`
          )
        }

        declaredTotal += file.originalSize
        if (declaredTotal > effective.maxTotalBytes) {
          throw new PluginPackageError(
            "limit",
            `Plugin package expands beyond ${effective.maxTotalBytes} bytes`
          )
        }
        return true
      },
    })
  } catch (error) {
    if (error instanceof PluginPackageError) throw error
    throw new PluginPackageError("archive", `Invalid plugin package: ${errorMessage(error)}`, {
      cause: error,
    })
  }

  const files = Object.entries(extracted)
    .map(([path, data]): PluginPackageFile => ({ path, data }))
    .sort((a, b) => a.path.localeCompare(b.path))

  let actualTotal = 0
  for (const file of files) {
    if (!isSafePackagePath(file.path)) {
      throw new PluginPackageError("path", `Unsafe package path: ${file.path}`)
    }
    if (file.data.byteLength > effective.maxFileBytes) {
      throw new PluginPackageError(
        "limit",
        `Package file ${file.path} exceeds ${effective.maxFileBytes} bytes`
      )
    }
    actualTotal += file.data.byteLength
  }
  if (files.length > effective.maxFiles) {
    throw new PluginPackageError(
      "limit",
      `Plugin package contains more than ${effective.maxFiles} files`
    )
  }
  if (actualTotal > effective.maxTotalBytes) {
    throw new PluginPackageError(
      "limit",
      `Plugin package expands beyond ${effective.maxTotalBytes} bytes`
    )
  }

  const manifestFile = files.find((file) => file.path === PLUGIN_MANIFEST_PATH)
  if (!manifestFile) {
    throw new PluginPackageError("manifest", `Plugin package is missing ${PLUGIN_MANIFEST_PATH}`)
  }
  if (manifestFile.data.byteLength > effective.maxManifestBytes) {
    throw new PluginPackageError(
      "limit",
      `${PLUGIN_MANIFEST_PATH} exceeds ${effective.maxManifestBytes} bytes`
    )
  }

  const manifestText = decodeUtf8(manifestFile.data, PLUGIN_MANIFEST_PATH)
  let manifestInput: unknown
  try {
    manifestInput = JSON.parse(
      manifestText.charCodeAt(0) === 0xfeff ? manifestText.slice(1) : manifestText
    )
  } catch (error) {
    throw new PluginPackageError("manifest", `${PLUGIN_MANIFEST_PATH} is not valid JSON`, {
      cause: error,
    })
  }

  let manifest: PluginManifest
  try {
    manifest = validatePluginManifest(manifestInput)
  } catch (error) {
    if (error instanceof PluginManifestError) {
      throw new PluginPackageError("manifest", error.message, { cause: error })
    }
    throw error
  }

  const available = new Set(files.map((file) => file.path))
  requireFile(available, manifest.entry, "entry")
  for (const style of manifest.styles ?? []) requireFile(available, style, "style")
  if (manifest.icon) requireFile(available, manifest.icon, "icon")

  return { manifest, files }
}

function requireFile(available: ReadonlySet<string>, path: string, label: string): void {
  if (!available.has(path)) {
    throw new PluginPackageError("missing-file", `Plugin manifest ${label} is missing: ${path}`)
  }
}

function decodeUtf8(data: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data)
  } catch (error) {
    throw new PluginPackageError("encoding", `${label} is not valid UTF-8`, { cause: error })
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
