import type { PluginPageProps } from "@orahako/plugin-sdk"

export function HelloPage({ pluginId }: PluginPageProps) {
  return (
    <main className="hello-plugin">
      <h2>Hello Plugin</h2>
      <p>
        This page is provided by <code>{pluginId}</code>.
      </p>
    </main>
  )
}
