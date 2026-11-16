import { describe, expect, it } from "vitest"
import {
  composeApplication,
  type AppComposition,
  type CompositionLayer,
} from "@orahako/plugin-sdk"

const base: AppComposition = {
  id: "app.base",
  version: 1,
  defaults: { shell: "orahako.shell:default", schoolId: "ysu" },
  nativeCapabilities: ["file@1"],
  plugins: [
    { id: "app.one", config: { size: 1, label: "one" }, protected: true },
    { id: "app.two", config: { enabled: true } },
  ],
}

describe("composeApplication", () => {
  it("rejects duplicate IDs inside one insertion batch", () => {
    expect(() =>
      composeApplication(base, [
        { id: "layer", plugins: [{ insert: [{ id: "b" }, { id: "b" }] }] },
      ])
    ).toThrow("Duplicate composition entry: b")
  })

  it("copies the base composition when no layer applies", () => {
    const result = composeApplication(base)

    expect(result).toEqual(base)
    expect(result).not.toBe(base)
    expect(result.plugins[0]).not.toBe(base.plugins[0])
    expect(result.defaults).not.toBe(base.defaults)
  })

  it("applies layers in order and lets later defaults win", () => {
    const layers: CompositionLayer[] = [
      { id: "app.landing", defaults: { landing: "overview" } },
      { id: "app.school", defaults: { schoolId: "zmu", landing: "grades" } },
    ]

    const result = composeApplication(base, layers)

    expect(result).toMatchObject({
      id: "app.base",
      version: 1,
      defaults: { shell: "orahako.shell:default", schoolId: "zmu", landing: "grades" },
      nativeCapabilities: ["file@1"],
    })
    expect(base.defaults).toEqual({ shell: "orahako.shell:default", schoolId: "ysu" })
  })

  it("replaces config wholesale instead of merging it", () => {
    const result = composeApplication(base, [
      { id: "app.override", plugins: [{ id: "app.one", config: { size: 2 } }] },
    ])

    expect(result.plugins[0]).toEqual({
      id: "app.one",
      config: { size: 2 },
      protected: true,
    })
    expect(result.plugins[0]?.config).not.toHaveProperty("label")
  })

  it("patches policy flags without touching unrelated rows", () => {
    const result = composeApplication(base, [
      {
        id: "app.policy",
        plugins: [
          { id: "app.one", disabled: true },
          { id: "app.two", protected: true },
        ],
      },
      { id: "app.re-enable", plugins: [{ id: "app.one", disabled: false }] },
    ])

    expect(result.plugins).toEqual([
      { id: "app.one", config: { size: 1, label: "one" }, protected: true, disabled: false },
      { id: "app.two", config: { enabled: true }, protected: true },
    ])
    expect(base.plugins[1]).toEqual({ id: "app.two", config: { enabled: true } })
  })

  it("appends inserted entries in layer order", () => {
    const result = composeApplication(base, [
      {
        id: "app.extra",
        plugins: [{ insert: [{ id: "app.three" }, { id: "app.four", disabled: true }] }],
      },
      { id: "app.extra-two", plugins: [{ insert: [{ id: "app.five" }] }] },
    ])

    expect(result.plugins.map((entry) => entry.id)).toEqual([
      "app.one",
      "app.two",
      "app.three",
      "app.four",
      "app.five",
    ])
    expect(result.plugins[3]).toMatchObject({ id: "app.four", disabled: true })
  })

  it("rejects an insert that also declares an id", () => {
    expect(() =>
      composeApplication(base, [
        {
          id: "app.broken",
          plugins: [{ id: "app.three", insert: [{ id: "app.three" }], disabled: true }],
        },
      ])
    ).toThrow("Composition insert must not declare an id: app.broken")
  })

  it("rejects inserting an id that already exists", () => {
    expect(() =>
      composeApplication(base, [
        { id: "app.duplicate", plugins: [{ insert: [{ id: "app.one" }] }] },
      ])
    ).toThrow("Duplicate composition entry: app.one")
  })

  it("rejects patches for unknown entries", () => {
    expect(() =>
      composeApplication(base, [
        { id: "app.unknown", plugins: [{ id: "app.missing", disabled: true }] },
      ])
    ).toThrow("Unknown composition entry app.missing in app.unknown")
  })

  it("rejects patches without an id", () => {
    expect(() =>
      composeApplication(base, [{ id: "app.anonymous", plugins: [{ config: {} }] }])
    ).toThrow("Composition patch requires an id: app.anonymous")
  })

  it("never mutates the base composition", () => {
    const before = structuredClone(base)
    composeApplication(base, [
      {
        id: "app.mutating",
        defaults: { landing: "overview" },
        plugins: [
          { id: "app.one", config: { size: 9 }, disabled: true },
          { id: "app.two", protected: false },
          { insert: [{ id: "app.three" }] },
        ],
      },
    ])

    expect(base).toEqual(before)
  })
})
