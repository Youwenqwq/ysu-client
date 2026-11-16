/**
 * @orahako/plugin-ui/stores — official Shell preference stores only.
 *
 * These stores describe the default Shell's UI preferences; they are not
 * runtime capabilities. Storage keys, secure storage and file media stay owned
 * by the module that persists them.
 */
export { useSettingsStore } from "@/plugins/official/shell/stores/settings"
export type {
  CardStyle,
  BackgroundStyle,
  LandingPage,
  WidgetAssistantPosition,
} from "@/plugins/official/shell/stores/settings"
export {
  useMobileHeaderStore,
  useMobileHeaderRight,
  useMobileHeaderLayout,
} from "@/plugins/official/shell/stores/mobile-header"
