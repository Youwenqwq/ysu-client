import { describe, expect, it } from "vitest"
import type { CompositionSource, PluginConfig, PluginManifest } from "@orahako/plugin-sdk"
import { validateCompositionSource, validatePluginConfig } from "./config"

function manifest(id: string, configSchema?: Record<string, unknown>): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 2,
    kind: "feature",
    entry: "index.js",
    configSchema,
  }
}

const sizedSchema = {
  type: "object",
  properties: {
    size: { type: "integer", default: 3 },
    label: { type: "string", default: "plugin" },
  },
  additionalProperties: false,
}

const sized = manifest("app.plugin", sizedSchema)
const plain = manifest("app.plugin")

function source(
  entries: CompositionSource["composition"]["plugins"],
  plugins: CompositionSource["plugins"]
): CompositionSource {
  return {
    appVersion: "0.0.0",
    appBuild: "test",
    composition: { id: "app.test", version: 1, defaults: {}, plugins: entries },
    plugins,
  }
}

describe("validatePluginConfig", () => {
  it("applies schema defaults", () => {
    expect(validatePluginConfig(sized, {})).toEqual({ size: 3, label: "plugin" })
    expect(validatePluginConfig(sized, { label: "custom" })).toEqual({
      size: 3,
      label: "custom",
    })
  })

  it("returns a deep clone of the caller config", () => {
    const nested: Record<string, number> = { value: 1 }
    const config: PluginConfig = { nested }
    const resolved = validatePluginConfig(plain, config)

    expect(resolved).toEqual({ nested: { value: 1 } })
    expect(resolved).not.toBe(config)
    expect(resolved.nested).not.toBe(nested)
    expect(nested).toEqual({ value: 1 })
  })

  it("rejects configs that violate the schema", () => {
    expect(() => validatePluginConfig(sized, { size: "big" })).toThrow(
      /Invalid config for app.plugin: \/size must be integer/
    )
    expect(() => validatePluginConfig(sized, { unknown: true })).toThrow(
      /Invalid config for app.plugin/
    )
  })

  it("rejects configs that are not objects", () => {
    expect(() => validatePluginConfig(plain, [] as unknown as PluginConfig)).toThrow(
      "Plugin config must be an object: app.plugin"
    )
    expect(() => validatePluginConfig(plain, null as unknown as PluginConfig)).toThrow(
      "Plugin config must be an object: app.plugin"
    )
  })
})

describe("validateCompositionSource", () => {
  it("accepts a source whose entries resolve to modules with valid configs", () => {
    const input = source(
      [{ id: "app.plugin", config: { size: 1 } }],
      [{ manifest: sized, definition: () => {} }]
    )
    expect(() => validateCompositionSource(input)).not.toThrow()
  })

  it("rejects duplicate modules", () => {
    const plugin = { manifest: plain, definition: () => {} }
    expect(() =>
      validateCompositionSource(source([{ id: "app.plugin" }], [plugin, plugin]))
    ).toThrow("Duplicate composition module: app.plugin")
  })

  it("rejects duplicate entries", () => {
    expect(() =>
      validateCompositionSource(
        source(
          [{ id: "app.plugin" }, { id: "app.plugin" }],
          [{ manifest: plain, definition: () => {} }]
        )
      )
    ).toThrow("Duplicate composition entry: app.plugin")
  })

  it("rejects entries without a module", () => {
    expect(() =>
      validateCompositionSource(source([{ id: "app.missing" }], []))
    ).toThrow("Composition module is not available: app.missing")
  })

  it("rejects entries whose config fails the module schema", () => {
    expect(() =>
      validateCompositionSource(
        source(
          [{ id: "app.plugin", config: { size: "big" } }],
          [{ manifest: sized, definition: () => {} }]
        )
      )
    ).toThrow(/Invalid config for app.plugin: \/size must be integer/)
  })
})
