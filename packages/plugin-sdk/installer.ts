import type { PluginManifest } from "./manifest"

/**
 * Public installation surface exposed to plugins as `ctx.plugins`.
 *
 * The host resolves the newest release compatible with the running app and
 * platform, then verifies and installs it, so plugins never need marketplace
 * URLs or hashes.
 */
export interface PluginInstallerService {
  /**
   * Installs the newest release of `pluginId` compatible with the current app
   * version and platform, returning the manifest of the installed plugin.
   *
   * @throws When the plugin is absent from the marketplace index or has no
   * release compatible with the current app version and platform.
   */
  installFromMarket(pluginId: string): Promise<PluginManifest>
}
