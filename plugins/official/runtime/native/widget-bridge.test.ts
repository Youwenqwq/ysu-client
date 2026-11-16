import { beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  capabilities: [] as Array<{ id: string; version: number; methods: string[] }>,
  invoke: vi.fn(),
}))

vi.mock("@orahako/plugin-sdk/native", () => ({
  loadNativeCapabilities: async () => native.capabilities,
}))

import {
  WIDGETS_EXAM_CAPABILITY,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  clearWidgetDataFromNative,
  invokeWidgetCapability,
  listNativeWidgets,
  requestWidgetPin,
  updateNativeWidget,
  updateNativeWidgetSettings,
  type WidgetNativeService,
} from "./widget-bridge"

function describeCapability(id: string, version = 1) {
  native.capabilities.push({ id, version, methods: [] })
}

/** Mirrors the capability reference matching the real scoped service performs. */
const service = {
  capabilities: {
    has: (reference: string) => {
      const separator = reference.lastIndexOf("@")
      const id = separator > 0 ? reference.slice(0, separator) : reference
      const version =
        separator > 0 && separator < reference.length - 1
          ? Number(reference.slice(separator + 1))
          : undefined
      return native.capabilities.some(
        (descriptor) =>
          descriptor.id === id && (version === undefined || descriptor.version === version)
      )
    },
    invoke: native.invoke,
  },
} as unknown as WidgetNativeService

describe("generic widget bridge", () => {
  beforeEach(() => {
    native.capabilities = []
    native.invoke.mockReset()
    describeCapability("widgets.generic")
    describeCapability("widgets.schedule")
    describeCapability("widgets.exam")
    describeCapability("widgets.community")
  })

  it("routes open string widget dispatch through the generic capability", async () => {
    native.invoke.mockResolvedValue({
      widgets: [{ id: "community.clock", provider: "P", capability: "widgets.community" }],
    })

    await expect(listNativeWidgets(service)).resolves.toEqual([
      { id: "community.clock", provider: "P", capability: "widgets.community" },
    ])
    expect(native.invoke).toHaveBeenCalledWith(WIDGETS_GENERIC_CAPABILITY, "list", undefined)
  })

  it("invokes a synthetic community widget capability without a schema change", async () => {
    native.invoke.mockResolvedValue({ ok: true })

    await expect(
      invokeWidgetCapability(service, "widgets.community@1", "sync", {
        widget: "community.clock",
        snapshot: { lines: ["A", "B"] },
      })
    ).resolves.toEqual({ ok: true })

    expect(native.invoke).toHaveBeenCalledWith("widgets.community@1", "sync", {
      widget: "community.clock",
      snapshot: { lines: ["A", "B"] },
    })
  })

  it("ignores a capability whose enabled version does not match", async () => {
    native.capabilities = native.capabilities.filter(
      (capability) => capability.id !== "widgets.generic"
    )
    describeCapability("widgets.generic", 2)

    await expect(
      invokeWidgetCapability(service, WIDGETS_GENERIC_CAPABILITY, "list")
    ).rejects.toThrow(`Native widget capability is unavailable: ${WIDGETS_GENERIC_CAPABILITY}`)
    expect(native.invoke).not.toHaveBeenCalled()
  })

  it("fails deterministically for an unregistered widget capability", async () => {
    await expect(invokeWidgetCapability(service, "widgets.gadget@1", "sync")).rejects.toThrow(
      "Native widget capability is unavailable: widgets.gadget@1"
    )
    expect(native.invoke).not.toHaveBeenCalled()
  })

  it("returns false when pinning is unavailable", async () => {
    native.invoke.mockRejectedValue(new Error("unsupported"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(requestWidgetPin(service, "schedule")).resolves.toBe(false)
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  it("only resolves a pin after the provider reports the new widget id", async () => {
    native.invoke.mockResolvedValue({ added: true })

    await expect(requestWidgetPin(service, "community.clock")).resolves.toBe(true)
    expect(native.invoke).toHaveBeenCalledWith(WIDGETS_GENERIC_CAPABILITY, "pin", {
      widget: "community.clock",
    })
  })

  it("routes declarative snapshots and settings to public widget contracts", async () => {
    native.invoke.mockResolvedValue(undefined)

    await updateNativeWidget(service, "community.clock", { lines: ["A"] }, { refreshMinutes: 5 })
    await updateNativeWidgetSettings(service, "community.clock", { refreshMinutes: 10 })
    await updateNativeWidgetSettings(service, null, { refreshMinutes: 15 })

    expect(native.invoke).toHaveBeenNthCalledWith(1, WIDGETS_GENERIC_CAPABILITY, "update", {
      widget: "community.clock",
      snapshot: { lines: ["A"] },
      settings: { refreshMinutes: 5 },
    })
    expect(native.invoke).toHaveBeenNthCalledWith(2, WIDGETS_GENERIC_CAPABILITY, "settings", {
      widget: "community.clock",
      settings: { refreshMinutes: 10 },
    })
    expect(native.invoke).toHaveBeenNthCalledWith(3, WIDGETS_GENERIC_CAPABILITY, "settings", {
      settings: { refreshMinutes: 15 },
    })
  })

  it("uses the schedule and exam companion capabilities for feature snapshots", async () => {
    native.invoke.mockResolvedValue(undefined)

    await invokeWidgetCapability(service, WIDGETS_SCHEDULE_CAPABILITY, "sync", { snapshot: {} })
    await invokeWidgetCapability(service, WIDGETS_EXAM_CAPABILITY, "sync", { snapshot: {} })

    expect(native.invoke.mock.calls.map(([id]) => id)).toEqual([
      WIDGETS_SCHEDULE_CAPABILITY,
      WIDGETS_EXAM_CAPABILITY,
    ])
  })

  it("keeps widget cleanup best-effort", async () => {
    native.invoke.mockRejectedValue(new Error("unavailable"))

    await expect(clearWidgetDataFromNative(service, "community.clock")).resolves.toBeUndefined()
    await expect(clearWidgetDataFromNative(service)).resolves.toBeUndefined()
    expect(native.invoke).toHaveBeenCalledTimes(2)
  })
})
