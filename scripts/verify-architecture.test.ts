import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { verifyArchitecture } from "./verify-architecture"

const temporaryRoots: string[] = []

async function createFixture(source: string) {
  const root = await mkdtemp(path.join(tmpdir(), "orahako-architecture-"))
  temporaryRoots.push(root)
  const packageDirectory = path.join(root, "packages", "plugins", "fixture")
  await mkdir(path.join(packageDirectory, "src"), { recursive: true })
  await writeFile(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@orahako/plugin-fixture",
      version: "0.0.0",
      exports: { ".": "./src/index.ts" },
    })
  )
  await writeFile(path.join(packageDirectory, "tsconfig.json"), "{}")
  await writeFile(path.join(packageDirectory, "src", "index.tsx"), source)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("verifyArchitecture", () => {
  it("detects named and namespace reactive-hook calls in source AST", async () => {
    const root = await createFixture(`
      import { useSyncExternalStore } from "react"
      import * as React from "react"
      export const fixture = () => {
        useSyncExternalStore(() => () => {}, () => 0)
        React.useSyncExternalStore(() => () => {}, () => 0)
        return null
      }
    `)

    const result = verifyArchitecture(root)
    const violations = result.diagnostics.filter(({ rule }) => rule === "direct-reactive-hook")
    expect(violations).toHaveLength(2)
  })

  it("detects scoped plugin context access in display TSX", async () => {
    const root = await createFixture(`
      import type { Context } from "@orahako/sdk"
      export const fixture = (ctx: Context) => <div>{ctx.provider}</div>
    `)

    const result = verifyArchitecture(root)
    expect(result.diagnostics.filter(({ rule }) => rule === "display-scoped-context")).toHaveLength(1)
  })
})
