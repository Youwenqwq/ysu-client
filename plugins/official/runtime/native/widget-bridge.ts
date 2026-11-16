/**
 * Official companion wrapper over the generic home-screen widget capabilities.
 *
 * Widget data is a declarative snapshot owned by the feature that produces it,
 * so this module intentionally knows nothing about courses, exams, or layouts.
 * It only routes to the versioned native widget capabilities, which are fixed
 * by the Android build composition. Unknown capabilities fail deterministically;
 * pin requests degrade to `false` because launchers may not support pinning.
 */
import { loadNativeCapabilities, type PluginNativeService } from "@orahako/plugin-sdk"

export const WIDGETS_GENERIC_CAPABILITY = "widgets.generic@1"
export const WIDGETS_SCHEDULE_CAPABILITY = "widgets.schedule@1"
export const WIDGETS_EXAM_CAPABILITY = "widgets.exam@1"

export type WidgetSnapshot = Record<string, unknown>
export type WidgetSettings = Record<string, unknown>
/** The scoped native service a plugin/component receives from `PluginContext`. */
export type WidgetNativeService = Pick<PluginNativeService, "capabilities">

export interface NativeWidgetInfo {
  /** Open string widget id declared by an enabled companion capability. */
  readonly id: string
  readonly provider: string
  readonly capability: string
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

/** Widgets declared by the enabled native composition. */
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

/** Resolves true only after the provider gains a new home-screen widget id. */
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
  } catch (error) {
    console.warn("Failed to request widget pin", error)
    // Older shells and unsupported launchers fall back to manual instructions.
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

/** Prunes snapshots for disabled/unowned widgets and repaints live widgets. */
export async function reconcileNativeWidgets(native: WidgetNativeService): Promise<void> {
  await invokeWidgetCapability(native, WIDGETS_GENERIC_CAPABILITY, "reconcile")
}

/**
 * Clears widget data. Cleanup is best-effort: plugin teardown must not surface
 * an unavailable widget capability to the UI.
 */
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
    // Widget cache cleanup is best-effort; fail silently.
  }
}
