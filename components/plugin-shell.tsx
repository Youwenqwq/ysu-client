"use client"

import { Component, type ReactNode } from "react"
import { usePluginHost } from "./plugin-context"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"
import type { RegisteredPluginShell } from "@/lib/plugins/ui-registry"

const DEFAULT_SHELL = "orahako.shell:default"

function shellKey(shell: RegisteredPluginShell): string {
  return `${shell.pluginId}:${shell.id}`
}

function KernelRecovery({ message }: { message?: string }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="text-lg font-semibold">应用界面未能加载</h1>
        <p className="text-sm text-muted-foreground">
          {message ?? "没有可用的应用 Shell。请重新加载，或清除站点数据后重试。"}
        </p>
        <button
          type="button"
          className="rounded-md border border-border px-4 py-2 text-sm"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    </main>
  )
}

class ShellBoundary extends Component<
  {
    shell: RegisteredPluginShell
    fallback?: RegisteredPluginShell
    children: ReactNode
    selectShell(id?: string): void
    onFailure: () => void
  },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error(
      `Plugin shell failed: ${shellKey(this.props.shell)}\n${error.stack ?? error.message}`
    )
    this.props.onFailure()
  }

  render() {
    if (this.state.failed) {
      if (!this.props.fallback) return <KernelRecovery />
      return (
        <ShellBoundary
          shell={this.props.fallback}
          selectShell={this.props.selectShell}
          onFailure={() => {}}
        >
          {this.props.children}
        </ShellBoundary>
      )
    }
    const Shell = this.props.shell.component
    return <Shell selectShell={this.props.selectShell}>{this.props.children}</Shell>
  }
}

export function PluginShell({ children }: { children: ReactNode }) {
  const { host } = usePluginHost()
  const { shells } = usePluginUI(host.ui)
  const activeShell = usePluginPreferences((state) => state.activeShell)
  const setActiveShell = usePluginPreferences((state) => state.setActiveShell)
  const fallback = shells.find((shell) => shellKey(shell) === DEFAULT_SHELL) ?? shells[0]
  const selected = shells.find((shell) => shellKey(shell) === activeShell)
  const shell = selected ?? fallback

  if (!shell) return <KernelRecovery />
  return (
    <ShellBoundary
      key={shellKey(shell)}
      shell={shell}
      selectShell={setActiveShell}
      fallback={
        selected && fallback && shellKey(selected) !== shellKey(fallback) ? fallback : undefined
      }
      onFailure={() => {
        if (activeShell) setActiveShell(undefined)
      }}
    >
      {children}
    </ShellBoundary>
  )
}
