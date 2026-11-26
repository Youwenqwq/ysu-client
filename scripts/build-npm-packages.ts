import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import ts from "typescript"
import {
  HOST_SELECTORS_SNAPSHOT_FILE,
  HOST_THEME_SNAPSHOT_FILE,
  compileHostUtilitySelectors,
  extractHostThemeBlock,
} from "@orahako/cli"

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url))

interface LibraryTarget {
  name: string
  dir: string
  entry: string
}

const LIBRARY_TARGETS: LibraryTarget[] = [
  { name: "@orahako/sdk", dir: path.join(REPO_ROOT, "packages/core/sdk"), entry: "src/index.ts" },
  {
    name: "@orahako/ui-primitives",
    dir: path.join(REPO_ROOT, "packages/core/ui-primitives"),
    entry: "src/index.ts",
  },
  {
    name: "@orahako/academic-sdk",
    dir: path.join(REPO_ROOT, "packages/edu/sdk"),
    entry: "src/index.ts",
  },
]

const CLI_DIR = path.join(REPO_ROOT, "packages/core/cli")

async function collectTsFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectTsFiles(full)))
    } else if (
      entry.isFile() &&
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/(?:\.test|\.spec|\.d)\.[^.]+$/.test(entry.name)
    ) {
      results.push(full)
    }
  }
  return results.sort()
}

async function emitDeclarations(
  pkgDir: string,
  extraPaths: Record<string, string[]> = {}
): Promise<void> {
  const srcDir = path.join(pkgDir, "src")
  const distDir = path.join(pkgDir, "dist")
  const files = await collectTsFiles(srcDir)

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.esnext.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    isolatedModules: true,
    declaration: true,
    emitDeclarationOnly: true,
    rootDir: srcDir,
    outDir: distDir,
    types: ["node"],
    paths: extraPaths,
  }

  const program = ts.createProgram(files, compilerOptions)
  const emitResult = program.emit()
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error)
  if (errors.length > 0) {
    const formatted = ts.formatDiagnosticsWithColorAndContext(errors, {
      getCurrentDirectory: () => pkgDir,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    })
    throw new Error(`TypeScript declaration emit failed for ${pkgDir}:\n${formatted}`)
  }
}

async function buildLibrary(target: LibraryTarget): Promise<void> {
  const distDir = path.join(target.dir, "dist")
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  await build({
    absWorkingDir: target.dir,
    entryPoints: [target.entry],
    outfile: path.join(distDir, "index.js"),
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: ["es2022"],
    packages: "external",
    jsx: "automatic",
    sourcemap: true,
    logLevel: "warning",
  })

  const extraPaths: Record<string, string[]> = {}
  if (target.name === "@orahako/academic-sdk") {
    extraPaths["@orahako/sdk"] = [path.join(REPO_ROOT, "packages/core/sdk/dist/index.d.ts")]
  }
  await emitDeclarations(target.dir, extraPaths)
  console.log(`Built ${target.name} -> ${path.relative(REPO_ROOT, distDir)}`)
}

async function buildCli(): Promise<void> {
  const distDir = path.join(CLI_DIR, "dist")
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })

  // 1. Snapshot host Tailwind theme tokens and compiled utility selectors
  const hostStylesheet = path.join(REPO_ROOT, "app/globals.css")
  const [hostTheme, hostSelectors] = await Promise.all([
    readFile(hostStylesheet, "utf8").then((css) => extractHostThemeBlock(css, hostStylesheet)),
    compileHostUtilitySelectors(REPO_ROOT),
  ])
  await Promise.all([
    writeFile(path.join(distDir, HOST_THEME_SNAPSHOT_FILE), `${hostTheme}\n`),
    writeFile(
      path.join(distDir, HOST_SELECTORS_SNAPSHOT_FILE),
      `${JSON.stringify([...hostSelectors].sort(), null, 2)}\n`
    ),
  ])

  // 2. Bundle library + CLI binary, inlining only @orahako/kernel's ZIP validator
  const cliPkg = JSON.parse(await readFile(path.join(CLI_DIR, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }
  const externalDeps = Object.keys(cliPkg.dependencies ?? {})

  const commonBuildOptions = {
    absWorkingDir: CLI_DIR,
    bundle: true,
    format: "esm" as const,
    platform: "node" as const,
    target: ["node20"],
    external: externalDeps,
    logLevel: "warning" as const,
  }

  await Promise.all([
    build({
      ...commonBuildOptions,
      entryPoints: ["src/index.ts"],
      outfile: path.join(distDir, "index.js"),
      sourcemap: true,
    }),
    build({
      ...commonBuildOptions,
      entryPoints: ["src/bin.ts"],
      outfile: path.join(distDir, "bin.js"),
    }),
  ])

  await chmod(path.join(distDir, "bin.js"), 0o755)
  await writeFile(
    path.join(distDir, "index.d.ts"),
    [
      "export declare const HOST_THEME_SNAPSHOT_FILE: string",
      "export declare const HOST_SELECTORS_SNAPSHOT_FILE: string",
      "export declare const PLUGIN_TAILWIND_STYLESHEET: string",
      "export interface PackedPlugin {",
      "  id: string",
      "  version: string",
      "  output: string",
      "  size: number",
      "  sha256: string",
      "}",
      "export interface PackPluginOptions {",
      "  hostRoot?: string",
      "}",
      "export declare function packPlugin(",
      "  pluginDirectory: string,",
      "  output?: string,",
      "  options?: PackPluginOptions",
      "): Promise<PackedPlugin>",
      "export declare function compileHostUtilitySelectors(hostRoot: string): Promise<Set<string>>",
      "export declare function extractHostThemeBlock(",
      "  stylesheet: string,",
      "  sourceName?: string",
      "): string",
      "",
    ].join("\n")
  )

  console.log(
    `Built @orahako/cli -> ${path.relative(REPO_ROOT, distDir)} (${hostSelectors.size} host utility selectors snapshotted)`
  )
}

async function main(): Promise<void> {
  for (const target of LIBRARY_TARGETS) {
    await buildLibrary(target)
  }
  await buildCli()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
