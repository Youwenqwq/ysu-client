import type { PluginNativeService } from "@orahako/plugin-sdk"

const WIDGETS_GENERIC_CAPABILITY = "widgets.generic@1"

/**
 * Requests a home-screen pin through the scoped native service.
 *
 * Launchers may not support pinning, so a failed request degrades to `false`
 * and callers fall back to manual instructions.
 */
export async function requestWidgetPin(
  native: PluginNativeService,
  widget: string
): Promise<boolean> {
  try {
    const result = await native.capabilities.invoke<{ added?: boolean }>(
      WIDGETS_GENERIC_CAPABILITY,
      "pin",
      { widget }
    )
    return result?.added === true
  } catch {
    return false
  }
}
