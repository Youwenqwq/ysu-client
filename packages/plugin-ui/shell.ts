/**
 * @orahako/plugin-ui/shell — host-aware shell components and runtime hooks.
 *
 * These read the live plugin provider/host context, so this submodule is kept
 * separate from the pure submodules: `lib/plugins/host.ts` imports
 * `@orahako/plugin-ui` submodules while also importing the official plugin
 * registry, whose plugins import those submodules in turn. Any export here
 * that loads `components/plugin-provider` (directly or via
 * `lib/navigation/use-semantic-navigation`) must stay on this submodule.
 */
export { ActivationGate } from "@/components/activation-gate"
export { MFAModal } from "@/components/mfa-modal"
export { BackgroundImage } from "@/components/background-image"
export { BackButtonHandler } from "@/components/back-button-handler"
export { DeepLinkHandler } from "@/components/deep-link-handler"
export { SDKProvider } from "@/components/sdk-provider"
export {
  ProviderProvider,
  useProviderContext,
  type ProviderContextValue,
} from "@/providers/provider-context"
// Toast + tooltip roots the shell mounts once (also in ./components).
export { Toaster } from "@/components/ui/sonner"
export { TooltipProvider } from "@/components/ui/tooltip"
export { MobileBottomNav } from "@/components/mobile-bottom-nav"
export { MobileTopBar } from "@/components/mobile-top-bar"
export { RefreshIndicator } from "@/components/refresh-indicator"
export { StaleIndicator } from "@/components/stale-indicator"
export { UpdateDialog } from "@/components/update-dialog"
export { usePluginTranslation } from "@/lib/plugins/use-plugin-translation"
export { usePluginHost } from "@/components/plugin-context"

// Dashboard overview composer (host dashboard component reused by the
// overview plugin and the settings page).
export { OverviewComposer, OverviewEditor } from "@/app/dashboard/overview/overview-composer"
