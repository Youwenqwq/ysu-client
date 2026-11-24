import { zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import {
  analyzeModuleImports,
  createHostModuleRegistry,
  createMemoryPackageBackend,
  ExternalPluginError,
  isSafePackagePath,
  loadExternalPlugin,
  parsePluginPackage,
  PluginPackageError,
  PluginPackageStore,
  resolveRelativePackagePath,
  type BlobUrlApi,
} from "@orahako/kernel"

function encodeZip(entries: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const raw: Record<string, Uint8Array> = {}
  for (const [path, content] of Object.entries(entries)) {
    raw[path] = typeof content === "string" ? encoder.encode(content) : content
  }
  return zipSync(raw)
}

function validManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: "community.hello",
    name: "Community Hello",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    entry: "dist/index.js",
    ...overrides,
  }
}

describe("package-path & parsePluginPackage", () => {
  it("validates relative paths and blocks traversal", () => {
    expect(isSafePackagePath("dist/index.js")).toBe(true)
    expect(isSafePackagePath("../secret.js")).toBe(false)
    expect(isSafePackagePath("/abs/path.js")).toBe(false)
    expect(resolveRelativePackagePath("dist/sub/mod.js", "../helper.js")).toBe("dist/helper.js")
    expect(resolveRelativePackagePath("dist/index.js", "../../escape.js")).toBeUndefined()
  })

  it("parses valid API v1 ZIP archives and rejects incompatible archives or missing assets", () => {
    const validBytes = encodeZip({
      "manifest.json": JSON.stringify(validManifest({ styles: ["dist/style.css"] })),
      "dist/index.js": "export default () => {}\n",
      "dist/style.css": ".hello { color: red; }\n",
    })
    const parsed = parsePluginPackage(validBytes)
    expect(parsed.manifest.id).toBe("community.hello")
    expect(parsed.manifest.apiVersion).toBe(1)
    expect(parsed.files.map((f) => f.path)).toEqual([
      "dist/index.js",
      "dist/style.css",
      "manifest.json",
    ])

    const v2Bytes = encodeZip({
      "manifest.json": JSON.stringify({ ...validManifest(), apiVersion: 2 }),
      "dist/index.js": "export default () => {}\n",
    })
    expect(() => parsePluginPackage(v2Bytes)).toThrow(PluginPackageError)

    const missingStyleBytes = encodeZip({
      "manifest.json": JSON.stringify(validManifest({ styles: ["dist/missing.css"] })),
      "dist/index.js": "export default () => {}\n",
    })
    expect(() => parsePluginPackage(missingStyleBytes)).toThrow("style is missing")
  })
})

describe("PluginPackageStore", () => {
  it("persists, lists, reads, and removes validated packages atomically", async () => {
    const store = new PluginPackageStore({
      backend: createMemoryPackageBackend(),
      now: () => 123456,
    })

    const zip = encodeZip({
      "manifest.json": JSON.stringify(validManifest()),
      "dist/index.js": "export default () => {}\n",
    })
    const installed = await store.install(zip)
    expect(installed.installedAt).toBe(123456)

    const listed = await store.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.manifest.id).toBe("community.hello")

    // Invalid update never replaces the installed package
    await expect(store.install(new Uint8Array([1, 2, 3]))).rejects.toThrow(PluginPackageError)
    expect((await store.read("community.hello"))?.manifest.version).toBe("1.0.0")

    await store.remove("community.hello")
    expect(await store.list()).toEqual([])
    store.close()
  })
})

describe("external-loader", () => {
  function createFakeBlobUrls() {
    const blobs = new Map<string, Blob>()
    const revoked = new Set<string>()
    let seq = 0
    const api: BlobUrlApi = {
      createObjectURL(blob) {
        const url = `blob:fake-${++seq}`
        blobs.set(url, blob)
        return url
      },
      revokeObjectURL(url) {
        revoked.add(url)
      },
    }
    return { api, blobs, revoked }
  }

  it("rewrites relative and platform imports, extracts styles/assets, and revokes URLs on dispose", async () => {
    const { api, blobs, revoked } = createFakeBlobUrls()
    const hostRegistry = createHostModuleRegistry(
      {
        "@orahako/sdk": { PLUGIN_API_VERSION: 1 },
      },
      api
    )

    const pkg = parsePluginPackage(
      encodeZip({
        "manifest.json": JSON.stringify(
          validManifest({
            styles: ["dist/tailwind.css"],
            icon: "assets/logo.svg",
          })
        ),
        "dist/helper.js": `export const label = "v1-helper"\n`,
        "dist/index.js": `import { PLUGIN_API_VERSION } from "@orahako/sdk"\nimport { label } from "./helper"\nexport default { apply() { return label + PLUGIN_API_VERSION } }\n`,
        "dist/tailwind.css": ".btn { padding: 4px; }",
        "assets/logo.svg": "<svg></svg>",
      })
    )

    expect((await analyzeModuleImports(`import { a } from "./x"`))[0]?.specifier).toBe("./x")

    const loaded = await loadExternalPlugin(pkg, {
      hostModules: hostRegistry,
      blobUrls: api,
      importModule: async (entryUrl) => {
        const source = await blobs.get(entryUrl)!.text()
        expect(source).toContain("blob:fake-")
        return { default: { apply: () => {} } }
      },
    })

    expect(loaded.styles).toEqual([{ path: "dist/tailwind.css", text: ".btn { padding: 4px; }" }])
    expect(loaded.assets.has("assets/logo.svg")).toBe(true)

    loaded.dispose()
    expect(revoked.size).toBeGreaterThanOrEqual(3)
    hostRegistry.dispose()
  })

  it("rejects unsupported bare imports and cyclic relative imports", async () => {
    const { api } = createFakeBlobUrls()

    const badBarePkg = parsePluginPackage(
      encodeZip({
        "manifest.json": JSON.stringify(validManifest()),
        "dist/index.js": `import "left-pad"\nexport default () => {}\n`,
      })
    )
    await expect(
      loadExternalPlugin(badBarePkg, { blobUrls: api, hostModules: {} })
    ).rejects.toThrow(ExternalPluginError)

    const cyclicPkg = parsePluginPackage(
      encodeZip({
        "manifest.json": JSON.stringify(validManifest()),
        "dist/a.js": `import "./index.js"\nexport const a = 1\n`,
        "dist/index.js": `import "./a.js"\nexport default () => {}\n`,
      })
    )
    await expect(loadExternalPlugin(cyclicPkg, { blobUrls: api, hostModules: {} })).rejects.toThrow(
      /Cyclic plugin import/
    )
  })
})
