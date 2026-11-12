import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { build } from "esbuild"
import { zipSync } from "fflate"
import { validatePluginManifest } from "../packages/plugin-sdk/manifest.ts"
import { SUPPORTED_HOST_MODULES } from "../packages/plugin-sdk/host-modules.ts"
import { parsePluginPackage } from "../lib/plugins/plugin-package.ts"

async function packPlugin(pluginDirectory: string, output?: string): Promise<void> {
  const directory = path.resolve(pluginDirectory)
  const manifestPath = path.join(directory, "manifest.json")
  const manifest = validatePluginManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  const sourceEntry = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts"].find((entry) =>
    existsSync(path.join(directory, entry))
  )
  if (!sourceEntry) throw new Error(`Missing plugin source entry in ${directory}`)

  await build({
    absWorkingDir: directory,
    entryPoints: [sourceEntry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome111"],
    outdir: "dist",
    external: [...SUPPORTED_HOST_MODULES],
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    logLevel: "warning",
  })

  const files: Record<string, Uint8Array> = {
    "manifest.json": new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  }
  await collectFiles(directory, path.join(directory, "dist"), files)
  const assetsDirectory = path.join(directory, "assets")
  if (existsSync(assetsDirectory)) await collectFiles(directory, assetsDirectory, files)
  if (!files[manifest.entry]) throw new Error(`Built entry is missing: ${manifest.entry}`)
  for (const style of manifest.styles ?? []) {
    if (!files[style]) throw new Error(`Built stylesheet is missing: ${style}`)
  }

  const archive = zipSync(files, { level: 9 })
  parsePluginPackage(archive)
  const outputPath = path.resolve(
    output ?? path.join(directory, `${manifest.id}-${manifest.version}.zip`)
  )
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, archive)
  const sha256 = createHash("sha256").update(archive).digest("hex")
  console.log(
    JSON.stringify(
      {
        id: manifest.id,
        version: manifest.version,
        output: outputPath,
        size: archive.length,
        sha256,
      },
      null,
      2
    )
  )
}

async function collectFiles(
  root: string,
  directory: string,
  files: Record<string, Uint8Array>
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(root, absolute, files)
    else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      files[relative] = new Uint8Array(await readFile(absolute))
    }
  }
}

const [command, directory, output] = process.argv.slice(2)
if (command !== "pack" || !directory) {
  console.error("Usage: pnpm plugin pack <plugin-directory> [output.zip]")
  process.exitCode = 1
} else {
  await packPlugin(directory, output)
}
