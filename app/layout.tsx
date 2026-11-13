import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/lib/i18n/context"
import { PwaRegister } from "@/components/pwa-register"
import { PwaUpdatePrompt } from "@/components/pwa-update-prompt"
import { PluginProvider } from "@/components/plugin-provider"
import { PluginThemeManager } from "@/components/plugin-theme-manager"
import { PluginShell } from "@/components/plugin-shell"
import { cn } from "@/lib/utils"

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  preload: false,
})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  preload: false,
})

export const metadata: Metadata = {
  title: {
    default: "酸橙盒",
    template: "%s · 酸橙盒",
  },
  description:
    "Orahako — a third-party shadcn/ui client for the Yanshan University academic system.",
  applicationName: "酸橙盒",
  authors: [{ name: "orahako contributors" }],
  keywords: ["酸橙盒", "Orahako", "燕山大学", "YSU", "教务系统"],
  appleWebApp: {
    capable: true,
    title: "酸橙盒",
    statusBarStyle: "default",
  },
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
          <PwaRegister />
          <PwaUpdatePrompt />
          <ThemeProvider>
            <PluginProvider>
              <PluginThemeManager />
              <PluginShell>{children}</PluginShell>
            </PluginProvider>
          </ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
