import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const env = { ...process.env, NEXT_PUBLIC_APP_PLATFORM: "harmony", NEXT_TELEMETRY_DISABLED: "1", APP_BASE_PATH: "" }
delete env.NEXT_PUBLIC_PROXY_BASE_URL
for (const args of [["node_modules/next/dist/bin/next", "build"], ["scripts/prepare-harmony.mjs"], ["scripts/verify-harmony.mjs"]]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
