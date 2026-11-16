/**
 * @orahako/plugin-ui/shell — host-aware shell components and runtime hooks.
 *
 * These read the live plugin provider/host context, so this submodule is kept
 * separate from the pure submodules: `lib/plugins/host.ts` imports
 * `@orahako/plugin-ui` submodules while also importing the official plugin
 * registry, whose plugins import those submodules in turn. Any export here
 * that loads `components/plugin-provider` (directly or via
 * `lib/navigation/use-semantic-navigation`) must stay on this submodule.
 *
 * Shell implementations live with the official composition
 * (`plugins/official/shell/components`); the generic kernel in `components/`
 * only keeps composition, routing, loading and recovery components.
 */
export { ActivationGate } from "@/plugins/official/shell/components/activation-gate"
export { MFAModal } from "@/plugins/official/shell/components/mfa-modal"
export { BackgroundImage } from "@/plugins/official/shell/components/background-image"
export { BackButtonHandler } from "@/plugins/official/shell/components/back-button-handler"
export { DeepLinkHandler } from "@/plugins/official/shell/components/deep-link-handler"
export { SDKProvider } from "@/plugins/official/shell/components/sdk-provider"
export { ProviderProvider } from "./provider"
export { usePluginManager } from "@/components/plugin-context"
// Toast + tooltip roots the shell mounts once (also in ./components).
export { Toaster } from "@/components/ui/sonner"
export { TooltipProvider } from "@/components/ui/tooltip"
export { MobileBottomNav } from "@/plugins/official/shell/components/mobile-bottom-nav"
export { MobileTopBar } from "@/plugins/official/shell/components/mobile-top-bar"
export { RefreshIndicator } from "@/plugins/official/runtime/query/refresh-indicator"
export { StaleIndicator } from "@/plugins/official/runtime/query/stale-indicator"
export { UpdateDialog } from "@/plugins/official/shell/components/update-dialog"
export { usePluginTranslation } from "@/plugins/official/runtime/i18n/use-plugin-translation"
