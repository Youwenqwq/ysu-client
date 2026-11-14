import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/postcss"
import postcss from "postcss"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("..", import.meta.url))

describe("host stylesheet scan boundary", () => {
  it("scans host-owned sources but not external plugin packages", async () => {
    const input = await readFile(path.join(root, "app/globals.css"), "utf8")
    const { css } = await postcss([tailwindcss({ base: root })]).process(input, {
      from: path.join(root, "app/globals.css"),
    })

    // Statically linked packages and app components stay part of the host build.
    expect(css).toMatch(/\.bg-schedule-1\s*\{[^}]*background-color:\s*var\(--schedule-1\)/)
    expect(css).toMatch(/\.text-muted-foreground\s*\{[^}]*color:\s*var\(--muted-foreground\)/)

    // Classes that only exist in an external plugin package must not leak in:
    // the packaged plugin ZIP has to provide them itself.
    expect(css).not.toContain(".bg-background\\/65")
  })
})
