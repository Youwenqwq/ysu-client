import { strToU8 } from "fflate"
import { describe, expect, it } from "vitest"
import type { PluginManifest } from "@ysu/plugin-sdk"
import {
  analyzeModuleImports,
  applyModuleImportRewrites,
  createHostModuleRegistry,
  loadExternalPlugin,
  type BlobUrlApi,
} from "./external-loader"
import type { PluginPackage, PluginPackageFile } from "./plugin-package"

const manifest: PluginManifest = {
  id: "org.example.feature",
  name: "Example feature",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

const definition = { name: "Example", apply() {} }

function makePackage(
  files: Record<string, string>,
  manifestOverrides: Partial<PluginManifest> = {}
): PluginPackage {
  const effectiveManifest = { ...manifest, ...manifestOverrides }
  const entries: Record<string, string> = {
    "manifest.json": JSON.stringify(effectiveManifest),
    ...files,
  }
  const packageFiles: PluginPackageFile[] = Object.entries(entries)
    .map(([path, text]) => ({ path, data: strToU8(text) }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { manifest: effectiveManifest, files: packageFiles }
}

function createBlobUrlFixture(): {
  api: BlobUrlApi
  blobs: Map<string, Blob>
  revoked: string[]
} {
  let sequence = 0
  const blobs = new Map<string, Blob>()
  const revoked: string[] = []
  return {
    api: {
      createObjectURL(blob) {
        const url = `blob:test/${++sequence}`
        blobs.set(url, blob)
        return url
      },
      revokeObjectURL(url) {
        revoked.push(url)
        blobs.delete(url)
      },
    },
    blobs,
    revoked,
  }
}

describe("analyzeModuleImports and applyModuleImportRewrites", () => {
  it("rewrites static, re-export, and literal dynamic imports", async () => {
    const source = [
      'import { useState } from "react"',
      'export * from "react-dom"',
      'const lazy = () => import("./chunk.js")',
      "const ignored = (name) => import(`./${name}.js`)",
      "const meta = import.meta.url",
    ].join("\n")

    const references = await analyzeModuleImports(source)
    expect(references.map((reference) => reference.specifier)).toEqual([
      "react",
      "react-dom",
      "./chunk.js",
    ])
    expect(references.map((reference) => reference.dynamic)).toEqual([false, false, true])

    const rewritten = applyModuleImportRewrites(
      source,
      references.map((reference) => ({
        reference,
        url: `blob:${reference.specifier}`,
      }))
    )
    expect(rewritten).toContain('from "blob:react"')
    expect(rewritten).toContain('from "blob:react-dom"')
    expect(rewritten).toContain('import("blob:./chunk.js")')
    expect(rewritten).toContain("import.meta.url")
  })

  it("reports unparsable modules", async () => {
    await expect(analyzeModuleImports("import {")).rejects.toMatchObject({
      code: "module",
    })
  })
})

describe("createHostModuleRegistry", () => {
  it("creates shared host Blob modules and revokes them on dispose", async () => {
    const fixture = createBlobUrlFixture()
    const react = { useState: () => "state", default: { version: "19" } }
    const registry = createHostModuleRegistry({ react }, fixture.api)

    const url = registry.resolve("react")
    expect(url).toBeTruthy()
    expect(registry.resolve("react-dom")).toBeUndefined()

    const source = await fixture.blobs.get(url!)!.text()
    expect(source).toContain('export const useState = host["useState"]')
    expect(source).toContain('export default host["default"]')

    registry.dispose()
    expect(fixture.revoked).toEqual([url])
    expect(fixture.blobs.size).toBe(0)
    expect(registry.resolve("react")).toBeUndefined()

    registry.dispose()
    expect(fixture.revoked).toEqual([url])
  })
})

describe("loadExternalPlugin", () => {
  it("loads provider SDK subpaths through host modules", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({
      "index.js":
        'import { ProviderError } from "@ysu/plugin-sdk/provider-errors"; export default { apply() {} }',
    })
    await loadExternalPlugin(pkg, {
      hostModules: { "@ysu/plugin-sdk/provider-errors": "blob:provider-errors" },
      blobUrls: fixture.api,
      importModule: async (url) => {
        expect(await fixture.blobs.get(url)!.text()).toContain('from "blob:provider-errors"')
        return { default: definition }
      },
    })
  })

  it("loads the entry graph, styles, and assets, then revokes every URL", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage(
      {
        "index.js": [
          'import { useState } from "react"',
          'import { helper } from "./lib/helper.js"',
          "export default { apply() {} }",
        ].join("\n"),
        "lib/helper.js": "export function helper() { return 1 }",
        "style.css": "body { color: red }",
        "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" />',
      },
      { styles: ["style.css"], icon: "icon.svg" }
    )

    let importedUrl = ""
    const loaded = await loadExternalPlugin(pkg, {
      hostModules: { react: "blob:host-react" },
      blobUrls: fixture.api,
      importModule: async (url) => {
        importedUrl = url
        const source = await fixture.blobs.get(url)!.text()
        expect(source).toContain('from "blob:host-react"')
        expect(source).toMatch(/from "blob:test\/\d+"/)
        return { default: definition }
      },
    })

    expect(importedUrl).toBeTruthy()
    expect(loaded.definition).toBe(definition)
    expect(loaded.manifest).toEqual({
      ...manifest,
      styles: ["style.css"],
      icon: "icon.svg",
    })
    expect(loaded.styles).toEqual([{ path: "style.css", text: "body { color: red }" }])

    const iconUrl = loaded.assets.get("icon.svg")
    expect(iconUrl).toBeTruthy()
    expect(fixture.blobs.get(iconUrl!)?.type).toBe("image/svg+xml")
    expect(loaded.assets.has("style.css")).toBe(false)
    expect(loaded.assets.has("index.js")).toBe(false)
    expect(loaded.assets.has("manifest.json")).toBe(false)

    const helperSource = await Promise.all([...fixture.blobs.values()].map((blob) => blob.text()))
    expect(helperSource.some((source) => source.includes("function helper"))).toBe(true)

    const createdCount = fixture.revoked.length
    loaded.dispose()
    expect(fixture.revoked).toHaveLength(createdCount + 3)
    expect(fixture.blobs.size).toBe(0)
    expect(loaded.assets.size).toBe(0)

    loaded.dispose()
    expect(fixture.revoked).toHaveLength(createdCount + 3)
  })

  it("rewrites literal dynamic imports to module Blob URLs", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({
      "index.js": 'export default { apply() { return import("./lib/lazy.js") } }',
      "lib/lazy.js": "export const value = 1",
    })

    let entrySource = ""
    await loadExternalPlugin(pkg, {
      hostModules: {},
      blobUrls: fixture.api,
      importModule: async (url) => {
        entrySource = await fixture.blobs.get(url)!.text()
        return { default: definition }
      },
    })

    expect(entrySource).toContain('import("blob:test/')
  })

  it("rejects unsupported bare imports without creating URLs", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({
      "index.js": 'import lodash from "lodash"\nexport default {}',
    })

    await expect(
      loadExternalPlugin(pkg, {
        hostModules: {},
        blobUrls: fixture.api,
        importModule: async () => ({ default: definition }),
      })
    ).rejects.toMatchObject({ code: "unsupported-import" })
    expect(fixture.revoked).toHaveLength(0)
  })

  it("rejects missing relative imports", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({ "index.js": 'import "./missing.js"\nexport default {}' })

    await expect(loadExternalPlugin(pkg, { blobUrls: fixture.api })).rejects.toMatchObject({
      code: "missing-import",
    })
  })

  it("rejects relative imports that escape the package", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({ "index.js": 'import "../../escape.js"\nexport default {}' })

    await expect(loadExternalPlugin(pkg, { blobUrls: fixture.api })).rejects.toMatchObject({
      code: "missing-import",
    })
  })

  it("rejects circular module graphs", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({
      "index.js": 'import "./a.js"\nexport default {}',
      "a.js": 'import "./b.js"',
      "b.js": 'import "./a.js"',
    })

    await expect(loadExternalPlugin(pkg, { blobUrls: fixture.api })).rejects.toMatchObject({
      code: "cyclic-import",
    })
    expect(fixture.revoked).toHaveLength(0)
  })

  it("rejects entries without a PluginDefinition default export and revokes URLs", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({ "index.js": "export default 42" })

    await expect(
      loadExternalPlugin(pkg, {
        blobUrls: fixture.api,
        importModule: async () => ({}),
      })
    ).rejects.toMatchObject({ code: "invalid-entry" })
    expect(fixture.blobs.size).toBe(0)
  })

  it("revokes URLs when importing the entry fails", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({
      "index.js": "export default {}",
      "style.css": "body {}",
      "icon.svg": "<svg />",
    })

    await expect(
      loadExternalPlugin(pkg, {
        blobUrls: fixture.api,
        importModule: async () => {
          throw new Error("boom")
        },
      })
    ).rejects.toMatchObject({ code: "invalid-entry" })
    expect(fixture.blobs.size).toBe(0)
  })

  it("reports invalid UTF-8 module sources", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({ "index.js": "export default {}" })
    pkg.files = pkg.files.map((file) =>
      file.path === "index.js" ? { ...file, data: new Uint8Array([0xff, 0xfe]) } : file
    )

    await expect(loadExternalPlugin(pkg, { blobUrls: fixture.api })).rejects.toMatchObject({
      code: "encoding",
    })
  })

  it("reports missing styles", async () => {
    const fixture = createBlobUrlFixture()
    const pkg = makePackage({ "index.js": "export default {}" }, { styles: ["missing.css"] })

    await expect(loadExternalPlugin(pkg, { blobUrls: fixture.api })).rejects.toMatchObject({
      code: "missing-style",
    })
  })
})
