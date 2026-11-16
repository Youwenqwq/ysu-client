/**
 * @orahako/plugin-ui/platform — platform detection, version metadata and the
 * shared back-navigation contract.
 *
 * Native capabilities, notifications, widgets and login throttling are
 * services: use the scoped `PluginContext` (`native`, `session`, `query`) or
 * the owning official module instead of importing bridge globals.
 */
export { isCapacitor, isTablet } from "@orahako/plugin-sdk/native"
export {
  BACK_PRIORITY,
  registerBackHandler,
  consumeBackLayer,
  requestBack,
  setNavigationBackHandler,
} from "./back"
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"
export const APP_BUILD = process.env.NEXT_PUBLIC_APP_BUILD ?? "dev"
