/** 检测当前是否在 Capacitor 原生环境中运行。 */

export function isCapacitor(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Capacitor } = require("@capacitor/core")
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** Tablets have a shorter screen edge >= 600 CSS pixels (covers budget tablets). */
export function isTablet(): boolean {
  if (typeof window === "undefined") return false
  const shortEdge = Math.min(window.screen.width, window.screen.height)
  return shortEdge >= 600
}
