/**
 * @orahako/plugin-ui/platform — native bridge, navigation, and widget helpers.
 */
export { isCapacitor, isTablet } from "@/lib/native/platform"
export {
  syncScheduleToWidget,
  syncExamsToWidget,
  syncWidgetSettingsToWidget,
  requestWidgetPin,
  clearWidgetDataFromNative,
  type NativeWidgetId,
  type WidgetCourse,
  type WidgetWeekInfo,
  type WidgetExam,
} from "@/lib/native/widget-bridge"
export { syncClassAlarmsToNative, stopNotify } from "@/lib/native/notify"
export { OrahakoFile, type OrahakoFilePlugin } from "@/lib/native/orahako-file"
export {
  BACK_PRIORITY,
  registerBackHandler,
  consumeBackLayer,
  requestBack,
} from "@/lib/navigation/back"
export {
  checkRateLimit,
  recordLoginAttempt,
  clearLoginAttempts,
  formatRetryDuration,
  rateLimitMessage,
} from "@/lib/rate-limit"
export {
  APP_VERSION,
  APP_BUILD,
  APP_COPYRIGHT,
  APP_LICENSE,
  APP_OPEN_SOURCE,
  APP_PEOPLE,
  APP_REPO,
} from "@/lib/version"
