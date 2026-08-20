import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { I18nProvider } from "@/lib/i18n/context"
import { SDKProvider } from "@/components/sdk-provider"
import { MFAModal } from "@/components/mfa-modal"
import { BackgroundImage } from "@/components/background-image"
import { BackButtonHandler } from "@/components/back-button-handler"
import { DeepLinkHandler } from "@/components/deep-link-handler"
import { NotifyProvider } from "@/components/notify-provider"
import { ProviderProvider } from "@/providers/provider-context"
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans', preload: false })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  preload: false,
})

export const metadata: Metadata = {
  title: {
    default: "燕大终端",
    template: "%s · 燕大终端",
  },
  description: "YSU Terminal — a third-party shadcn/ui client for the Yanshan University academic system.",
  applicationName: "燕大终端",
  authors: [{ name: "ysu-client contributors" }],
  keywords: ["燕大终端", "YSU Terminal", "燕山大学", "YSU", "教务系统"],
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <I18nProvider>
          <ThemeProvider>
            <ProviderProvider>
              <SDKProvider>
                <TooltipProvider>
                  <BackgroundImage />
                  <BackButtonHandler />
                  <DeepLinkHandler />
                  <NotifyProvider />
                  {children}
                  <Toaster />
                  <MFAModal />
                </TooltipProvider>
              </SDKProvider>
            </ProviderProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
