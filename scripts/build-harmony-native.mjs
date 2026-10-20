import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

if (process.platform !== "win32") throw new Error("Use DevEco Studio to build on this operating system")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const harmony = join(root, "harmony")
const studio = process.env.DEVECOSTUDIO_HOME || "D:\\DevEco Studio"
const node = join(studio, "tools/node/node.exe")
const hvigor = join(studio, "tools/hvigor/bin/hvigorw.js")
if (!existsSync(node) || !existsSync(hvigor)) throw new Error("Set DEVECOSTUDIO_HOME to the installed DevEco Studio directory")
const env = { ...process.env, JAVA_HOME: join(studio, "jbr"), DEVECO_SDK_HOME: join(studio, "sdk") }
function run(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, env, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(process.execPath, ["scripts/build-harmony.mjs"], root)
const modules = join(harmony, "node_modules/@ohos")
mkdirSync(modules, { recursive: true })
for (const name of ["hvigor", "hvigor-ohos-plugin"]) {
  const source = join(studio, "tools/hvigor", name)
  const destination = join(modules, name)
  if (!existsSync(destination)) symlinkSync(source, destination, "junction")
  if (realpathSync(destination) !== realpathSync(source)) {
    throw new Error("The project Hvigor installation does not match this DevEco Studio")
  }
}
writeFileSync(join(harmony, "local.properties"), `sdk.dir=${join(studio, "sdk").replaceAll("\\", "/")}\n`)
run(node, [hvigor, "--mode", "module", "-p", "product=default", "-p", "buildMode=debug", "assembleHap", "--no-daemon"], harmony)
console.log("Unsigned HAP:", join(harmony, "entry/build/default/outputs/default/entry-default-unsigned.hap"))
