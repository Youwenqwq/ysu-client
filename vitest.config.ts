import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function resolvePackageEntry(pkgDir: string, pkgJson: Record<string, unknown>): string {
  const exportsField = pkgJson.exports
  const dotExport = isRecord(exportsField) ? exportsField["."] : exportsField
  if (typeof dotExport === "string") {
    return join(pkgDir, dotExport.replace(/^\.\//, ""))
  }
  const tsxEntry = join(pkgDir, "src", "index.tsx")
  if (existsSync(tsxEntry) && !existsSync(join(pkgDir, "src", "index.ts"))) {
    return tsxEntry
  }
  return join(pkgDir, "src", "index.ts")
}

function discoverWorkspaceAliases(): Array<{ find: RegExp; replacement: string }> {
  const packagesRoot = join(root, "packages")
  if (!existsSync(packagesRoot)) return []

  const aliases: Array<{ find: RegExp; replacement: string }> = []
  for (const groupEntry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!groupEntry.isDirectory()) continue
    const groupDir = join(packagesRoot, groupEntry.name)
    for (const pkgEntry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!pkgEntry.isDirectory()) continue
      const pkgDir = join(groupDir, pkgEntry.name)
      const manifestPath = join(pkgDir, "package.json")
      if (!existsSync(manifestPath)) continue

      const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"))
      if (!isRecord(parsed)) continue
      const pkgName = parsed.name
      if (typeof pkgName !== "string" || !pkgName.startsWith("@orahako/")) continue

      const escapedName = escapeRegExp(pkgName)
      aliases.push(
        {
          find: new RegExp(`^${escapedName}$`),
          replacement: resolvePackageEntry(pkgDir, parsed),
        },
        {
          find: new RegExp(`^${escapedName}/package\\.json$`),
          replacement: manifestPath,
        }
      )
    }
  }
  return aliases
}

const execArgv = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
  ? ["--no-experimental-webstorage"]
  : []

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${root}$1` }, ...discoverWorkspaceAliases()],
  },
  test: {
    environment: "node",
    execArgv,
    include: [
      "app/**/*.test.ts",
      "packages/**/*.test.ts",
      "packages/*/*/tests/**/*.test.ts",
      "packages/*/*/tests/**/*.test.tsx",
      "scripts/**/*.test.ts",
    ],
  },
})
