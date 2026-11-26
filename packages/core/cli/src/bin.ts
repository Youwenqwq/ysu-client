#!/usr/bin/env node
import process from "node:process"
import { packPlugin } from "./pack"

const USAGE = `Usage: orahako <command> [options]

Commands:
  pack <plugin-directory> [output.zip]   Validate, bundle, and package an API v1 plugin ZIP
`

async function main() {
  const args = process.argv.slice(2)
  const [command, directory, output] = args

  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE)
    return
  }

  if (command !== "pack" || !directory) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const packed = await packPlugin(directory, output)
  console.log(JSON.stringify(packed, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
