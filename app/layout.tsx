import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { appIdentity } from "./composition/identity"

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
  icons: {
    icon: `${process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""}/icon.svg`,
    apple: `${process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""}/icons/icon-192.png`,
  },
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
      className={`antialiased font-sans ${fontMono.variable} ${geist.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
