"use client"

import { definePlugin, PluginSlot, PLUGIN_API_VERSION, type PluginManifest, type PluginShellProps } from "@orahako/plugin-sdk"
import { PluginServicesProvider } from "@orahako/plugin-ui/plugin"
import {
  ActivationGate,
  BackButtonHandler,
  BackgroundImage,
  DeepLinkHandler,
  MFAModal,
  ProviderProvider,
  SDKProvider,
  Toaster,
  TooltipProvider,
} from "@orahako/plugin-ui/shell"
import DashboardLayout from "./dashboard-layout"
import { officialShellPages } from "./pages"

export const manifest: PluginManifest = {
  id: "orahako.shell",
  name: "酸橙盒界面",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "shell",
  inject: ["ui", "slots"],
  entry: "index.js",
  required: true,
}

function OfficialShell({ children, context }: PluginShellProps) {
  return (
    <PluginServicesProvider context={context}>
      <ProviderProvider>
        <ActivationGate>
          <SDKProvider>
            <TooltipProvider>
              <BackgroundImage />
              <BackButtonHandler />
              <DeepLinkHandler />
              {children}
              <PluginSlot name="shell.overlay" />
              <Toaster />
              <MFAModal />
            </TooltipProvider>
          </SDKProvider>
        </ActivationGate>
      </ProviderProvider>
    </PluginServicesProvider>
  )
}

export const definition = definePlugin((ctx) => {
  ctx.slots.declare({ name: "shell.overlay", kind: "list" })
  ctx.slots.declare({ name: "shell.activity", kind: "list" })
  ctx.slots.declare({ name: "dashboard.header.actions", kind: "list" })
  ctx.slots.declare({ name: "settings.startupOptions", kind: "list" })
  ctx.slots.declare({ name: "settings.widgets", kind: "list" })
  for (const page of officialShellPages) ctx.ui.registerPage(page)
  ctx.ui.registerShell({
    id: "default",
    name: "酸橙盒",
    component: OfficialShell,
    layout: DashboardLayout,
  })
})
