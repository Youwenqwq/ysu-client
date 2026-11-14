import process from "node:process"
import { packPlugin } from "./plugin-build.ts"

const [command, directory, output] = process.argv.slice(2)
if (command !== "pack" || !directory) {
  console.error("Usage: pnpm plugin pack <plugin-directory> [output.zip]")
  process.exitCode = 1
} else {
  const packed = await packPlugin(directory, output)
  console.log(JSON.stringify(packed, null, 2))
}
