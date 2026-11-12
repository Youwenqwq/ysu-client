import { Zip, ZipPassThrough, strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import {
  PLUGIN_MANIFEST_PATH,
  PluginPackageError,
  parsePluginPackage,
  pluginPackageFile,
} from "./plugin-package"

const manifest = {
  id: "org.example.feature",
  name: "Example feature",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
  styles: ["style.css"],
  icon: "icon.svg",
}

const contents: Record<string, Uint8Array> = {
  [PLUGIN_MANIFEST_PATH]: strToU8(JSON.stringify(manifest)),
  "index.js": strToU8("export default { apply() {} }"),
  "style.css": strToU8("body { color: red }"),
  "icon.svg": strToU8('<svg xmlns="http://www.w3.org/2000/svg" />'),
}

function buildArchive(overrides: Record<string, Uint8Array | null> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = { ...contents }
  for (const [path, data] of Object.entries(overrides)) {
    if (data) files[path] = data
    else delete files[path]
  }
  return zipSync(files)
}

function buildDuplicateArchive(entries: readonly [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = []
  const zip = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  for (const [path, data] of entries) {
    const file = new ZipPassThrough(path)
    zip.add(file)
    file.push(data, true)
  }
  zip.end()
  const total = chunks.reduce((size, chunk) => size + chunk.byteLength, 0)
  const archive = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    archive.set(chunk, offset)
    offset += chunk.byteLength
  }
  return archive
}

function expectPackageError(run: () => unknown, code: PluginPackageError["code"]): void {
  try {
    run()
  } catch (error) {
    if (!(error instanceof PluginPackageError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected PluginPackageError with code ${code}`)
}

describe("parsePluginPackage", () => {
  it("parses the manifest and package files", () => {
    const pkg = parsePluginPackage(buildArchive())

    expect(pkg.manifest).toEqual(manifest)
    expect(pkg.files.map((file) => file.path)).toEqual([
      "icon.svg",
      "index.js",
      "manifest.json",
      "style.css",
    ])
    expect(pluginPackageFile(pkg, "index.js")?.data).toEqual(contents["index.js"])
    expect(pluginPackageFile(pkg, "missing.js")).toBeUndefined()
  })

  it("accepts compressed data backed by an ArrayBuffer", async () => {
    const archive = buildArchive()
    const buffer = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength
    ) as ArrayBuffer
    const pkg = parsePluginPackage(buffer)
    expect(pkg.manifest.id).toBe(manifest.id)
  })

  it("reports corrupt ZIP data", () => {
    expectPackageError(() => parsePluginPackage(new Uint8Array([1, 2, 3, 4])), "archive")
    expectPackageError(() => parsePluginPackage(new Uint8Array()), "archive")
  })

  it.each([
    "../escape.js",
    "/absolute.js",
    "dist/../../escape.js",
    "dist\\windows.js",
    "a//b.js",
    "./relative.js",
  ])("rejects malicious package path %s", (path) => {
    expectPackageError(() => parsePluginPackage(buildArchive({ [path]: strToU8("x") })), "path")
  })

  it("rejects duplicate file entries", () => {
    const archive = buildDuplicateArchive([
      [PLUGIN_MANIFEST_PATH, contents[PLUGIN_MANIFEST_PATH]],
      ["index.js", contents["index.js"]],
      ["index.js", strToU8("export default {}")],
      ["style.css", contents["style.css"]],
      ["icon.svg", contents["icon.svg"]],
    ])
    expectPackageError(() => parsePluginPackage(archive), "duplicate")
  })

  it("rejects packages without a manifest", () => {
    expectPackageError(
      () => parsePluginPackage(buildArchive({ [PLUGIN_MANIFEST_PATH]: null })),
      "manifest"
    )
  })

  it("rejects malformed manifest JSON", () => {
    expectPackageError(
      () => parsePluginPackage(buildArchive({ [PLUGIN_MANIFEST_PATH]: strToU8("{") })),
      "manifest"
    )
  })

  it("rejects manifests that are not valid UTF-8", () => {
    expectPackageError(
      () =>
        parsePluginPackage(
          buildArchive({ [PLUGIN_MANIFEST_PATH]: new Uint8Array([0xff, 0xfe, 0x00]) })
        ),
      "encoding"
    )
  })

  it("rejects incompatible plugin API versions", () => {
    expectPackageError(
      () =>
        parsePluginPackage(
          buildArchive({
            [PLUGIN_MANIFEST_PATH]: strToU8(JSON.stringify({ ...manifest, apiVersion: 2 })),
          })
        ),
      "manifest"
    )
  })

  it("rejects manifests pointing at missing files", () => {
    expectPackageError(() => parsePluginPackage(buildArchive({ "index.js": null })), "missing-file")
    expectPackageError(
      () => parsePluginPackage(buildArchive({ "style.css": null })),
      "missing-file"
    )
    expectPackageError(() => parsePluginPackage(buildArchive({ "icon.svg": null })), "missing-file")
  })

  it("enforces archive, file, count, and expansion limits", () => {
    const archive = buildArchive()
    expectPackageError(() => parsePluginPackage(archive, { maxArchiveBytes: 16 }), "limit")
    expectPackageError(() => parsePluginPackage(archive, { maxFiles: 2 }), "limit")
    expectPackageError(() => parsePluginPackage(archive, { maxFileBytes: 4 }), "limit")
    expectPackageError(() => parsePluginPackage(archive, { maxTotalBytes: 8 }), "limit")
    expectPackageError(() => parsePluginPackage(archive, { maxManifestBytes: 4 }), "limit")
  })
})
