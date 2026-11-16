import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { AppComposition, appIdentity } from "./composition"
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
    default: appIdentity.name,
    template: `%s · ${appIdentity.name}`,
  },
  description: appIdentity.descriptionEn,
  applicationName: appIdentity.name,
  authors: [{ name: "orahako contributors" }],
  keywords: [appIdentity.name, appIdentity.nameEn],
  appleWebApp: {
    capable: true,
    title: appIdentity.name,
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
        <AppComposition>{children}</AppComposition>
      </body>
    </html>
  )
}
