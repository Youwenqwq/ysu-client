import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const result = spawnSync(process.execPath, ["scripts/build-harmony-native.mjs"], {
  cwd: root,
  env: { ...process.env, NEXT_PUBLIC_ECARD_DIAGNOSTICS: "1" },
  stdio: "inherit",
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
