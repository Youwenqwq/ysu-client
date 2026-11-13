"use client"

import type { ReactNode } from "react"
import { definePlugin, PluginSlot, type PluginManifest } from "@ysu/plugin-sdk"
import {
  ActivationGate,
  BackButtonHandler,
  BackgroundImage,
  DeepLinkHandler,
  MFAModal,
  NotifyProvider,
  ProviderProvider,
  SDKProvider,
  Toaster,
  TooltipProvider,
} from "@ysu/plugin-ui/shell"

export const manifest: PluginManifest = {
  id: "ysu.shell",
  name: "燕大终端界面",
  version: "1.0.0",
  apiVersion: 1,
  kind: "shell",
  entry: "index.js",
  required: true,
}

function OfficialShell({ children }: { children: ReactNode }) {
  return (
    <ProviderProvider>
      <ActivationGate>
        <SDKProvider>
          <TooltipProvider>
            <BackgroundImage />
            <BackButtonHandler />
            <DeepLinkHandler />
            <NotifyProvider />
            {children}
            <PluginSlot name="shell.overlay" />
            <Toaster />
            <MFAModal />
          </TooltipProvider>
        </SDKProvider>
      </ActivationGate>
    </ProviderProvider>
  )
}

export const definition = definePlugin((ctx) => {
  ctx.slots.declare({ name: "shell.overlay", kind: "list" })
  ctx.slots.declare({ name: "dashboard.header.actions", kind: "list" })
  ctx.ui.registerShell({ id: "default", name: "燕大终端", component: OfficialShell })
})
