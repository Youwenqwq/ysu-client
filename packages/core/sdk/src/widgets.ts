import { loadNativeCapabilities, type PluginNativeService } from "./native"

export const WIDGETS_GENERIC_CAPABILITY = "widgets.generic@1"
export const WIDGETS_SCHEDULE_CAPABILITY = "widgets.schedule@1"
export const WIDGETS_EXAM_CAPABILITY = "widgets.exam@1"

export type WidgetSnapshot = Record<string, unknown>
export type WidgetSettings = Record<string, unknown>
export type WidgetNativeService = Pick<PluginNativeService, "capabilities">

export interface NativeWidgetInfo {
  readonly id: string
  readonly provider: string
  readonly capability: string
}

export interface PluginWidgetService {
  list(): Promise<readonly NativeWidgetInfo[]>
  requestPin(widget: string): Promise<boolean>
  update(widget: string, snapshot: WidgetSnapshot, settings?: WidgetSettings): Promise<void>
  updateSettings(widget: string | null, settings: WidgetSettings): Promise<void>
  reconcile(): Promise<void>
  clear(widget?: string): Promise<void>
  invoke<T = Record<string, unknown>>(
    capabilityId: string,
    method: string,
    payload?: Record<string, unknown>
  ): Promise<T>
}

export async function invokeWidgetCapability<T = Record<string, unknown>>(
  native: WidgetNativeService,
  capabilityId: string,
  method: string,
  payload?: Record<string, unknown>
): Promise<T> {
  await loadNativeCapabilities()
  if (!native.capabilities.has(capabilityId)) {
    throw new Error(`Native widget capability is unavailable: ${capabilityId}`)
  }
  return native.capabilities.invoke<T>(capabilityId, method, payload)
}

export async function listNativeWidgets(
  native: WidgetNativeService
): Promise<readonly NativeWidgetInfo[]> {
  const result = await invokeWidgetCapability<{ widgets?: NativeWidgetInfo[] }>(
    native,
    WIDGETS_GENERIC_CAPABILITY,
    "list"
  )
  return result.widgets ?? []
}

export async function requestWidgetPin(
  native: WidgetNativeService,
  widget: string
): Promise<boolean> {
  try {
    const result = await invokeWidgetCapability<{ added?: boolean }>(
      native,
      WIDGETS_GENERIC_CAPABILITY,
      "pin",
      { widget }
    )
    return result.added === true
  } catch {
    return false
  }
}

export async function updateNativeWidget(
  native: WidgetNativeService,
  widget: string,
  snapshot: WidgetSnapshot,
  settings?: WidgetSettings
): Promise<void> {
  await invokeWidgetCapability(native, WIDGETS_GENERIC_CAPABILITY, "update", {
    widget,
    snapshot,
    ...(settings ? { settings } : {}),
  })
}

export async function updateNativeWidgetSettings(
  native: WidgetNativeService,
  widget: string | null,
  settings: WidgetSettings
): Promise<void> {
  await invokeWidgetCapability(
    native,
    WIDGETS_GENERIC_CAPABILITY,
    "settings",
    widget ? { widget, settings } : { settings }
  )
}

export async function reconcileNativeWidgets(native: WidgetNativeService): Promise<void> {
  await invokeWidgetCapability(native, WIDGETS_GENERIC_CAPABILITY, "reconcile")
}

export async function clearWidgetDataFromNative(
  native: WidgetNativeService,
  widget?: string
): Promise<void> {
  try {
    await invokeWidgetCapability(
      native,
      WIDGETS_GENERIC_CAPABILITY,
      "clear",
      widget ? { widget } : {}
    )
  } catch {
    // Widget cache cleanup is best-effort during plugin teardown.
  }
}

export function createWidgetService(native: WidgetNativeService): PluginWidgetService {
  return {
    list: () => listNativeWidgets(native),
    requestPin: (widget) => requestWidgetPin(native, widget),
    update: (widget, snapshot, settings) => updateNativeWidget(native, widget, snapshot, settings),
    updateSettings: (widget, settings) => updateNativeWidgetSettings(native, widget, settings),
    reconcile: () => reconcileNativeWidgets(native),
    clear: (widget) => clearWidgetDataFromNative(native, widget),
    invoke: <T = Record<string, unknown>>(
      capabilityId: string,
      method: string,
      payload?: Record<string, unknown>
    ) => invokeWidgetCapability<T>(native, capabilityId, method, payload),
  }
}
