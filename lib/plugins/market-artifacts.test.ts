import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { validateMarketplaceIndex } from "./market"
import { onRequestGet } from "../../website/edge-functions/updates/plugins.json.js"

describe("published plugin market artifacts", () => {
  it("matches every published ZIP size and SHA-256", async () => {
    const response = (await onRequestGet()) as Response
    const index = validateMarketplaceIndex(await response.json())
    expect(index.plugins.length).toBeGreaterThan(0)

    for (const plugin of index.plugins) {
      for (const release of plugin.versions) {
        expect(release.zipUrl.startsWith("/plugins/")).toBe(true)
        const bytes = await readFile(`website/public${release.zipUrl}`)
        expect(bytes.length, `${plugin.id}@${release.version} size`).toBe(release.size)
        expect(
          createHash("sha256").update(bytes).digest("hex"),
          `${plugin.id}@${release.version} sha256`
        ).toBe(release.sha256)
      }
    }
  })
})
