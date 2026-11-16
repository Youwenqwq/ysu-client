"use client"

import type { ReactNode } from "react"
import { useActivePluginShell } from "@/components/plugin-shell"

export default function DashboardHostLayout({ children }: { children: ReactNode }) {
  const { shell } = useActivePluginShell()
  const Layout = shell?.layout
  return Layout ? <Layout>{children}</Layout> : children
}
