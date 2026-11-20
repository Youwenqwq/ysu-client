import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { validateMarketplaceIndex } from "@orahako/sdk"
import { describe, expect, it } from "vitest"
import { onRequestGet } from "../website/edge-functions/updates/plugins.json.js"

describe("published plugin market artifacts", () => {
  it("matches every published ZIP size and SHA-256", async () => {
    const response = onRequestGet()
    const index = validateMarketplaceIndex(await response.json())
    expect(index.plugins.length).toBeGreaterThan(0)

    for (const plugin of index.plugins) {
      expect(plugin.versions.length, plugin.id).toBeGreaterThan(0)
      for (const release of plugin.versions) {
        const label = `${plugin.id}@${release.version}`
        expect(release.zipUrl, label).toMatch(/^\/plugins\//)
        const bytes = await readFile(new URL(`../website/public${release.zipUrl}`, import.meta.url))
        expect(bytes.byteLength, `${label} size`).toBe(release.size)
        expect(createHash("sha256").update(bytes).digest("hex"), `${label} sha256`).toBe(
          release.sha256
        )
      }
    }
  })
})
