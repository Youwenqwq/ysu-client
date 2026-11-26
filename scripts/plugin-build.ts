import { fileURLToPath } from "node:url"
import {
  PLUGIN_TAILWIND_STYLESHEET,
  packPlugin as packPluginWithCli,
  type PackedPlugin,
} from "@orahako/cli"

const HOST_ROOT = fileURLToPath(new URL("..", import.meta.url))

export { PLUGIN_TAILWIND_STYLESHEET, type PackedPlugin }

export function packPlugin(pluginDirectory: string, output?: string): Promise<PackedPlugin> {
  return packPluginWithCli(pluginDirectory, output, { hostRoot: HOST_ROOT })
}
