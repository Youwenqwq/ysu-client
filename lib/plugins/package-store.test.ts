import { strToU8, zipSync } from "fflate"
import { describe, expect, it } from "vitest"
import {
  PluginPackageStore,
  type PluginPackageBackend,
  type PluginPackageSnapshot,
} from "./package-store"

const baseManifest = {
  id: "org.example.feature",
  name: "Example feature",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature" as const,
  entry: "index.js",
}

function buildArchive(
  overrides: Record<string, string | null> = {},
  manifestOverrides: Record<string, unknown> = {}
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify({ ...baseManifest, ...manifestOverrides })),
    "index.js": strToU8("export default { apply() {} }"),
  }
  for (const [path, content] of Object.entries(overrides)) {
    if (content === null) delete files[path]
    else files[path] = strToU8(content)
  }
  return zipSync(files)
}

class MemoryBackend implements PluginPackageBackend {
  readonly records = new Map<string, PluginPackageSnapshot>()
  failPuts = false
  closed = false

  async get(id: string): Promise<PluginPackageSnapshot | undefined> {
    return this.records.get(id)
  }

  async getAll(): Promise<readonly PluginPackageSnapshot[]> {
    return [...this.records.values()]
  }

  async put(snapshot: PluginPackageSnapshot): Promise<void> {
    if (this.failPuts) throw new Error("disk full")
    this.records.set(snapshot.manifest.id, snapshot)
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }

  close(): void {
    this.closed = true
  }
}

describe("PluginPackageStore", () => {
  it("installs, lists, reads, and removes packages", async () => {
    const backend = new MemoryBackend()
    let now = 100
    const store = new PluginPackageStore({ backend, now: () => now })

    const installed = await store.install(buildArchive())
    expect(installed.manifest.id).toBe(baseManifest.id)
    expect(installed.installedAt).toBe(100)

    now = 200
    await store.install(
      buildArchive({}, { id: "org.example.alpha", name: "Alpha", version: "2.0.0" })
    )

    expect(await store.list()).toEqual([
      {
        manifest: expect.objectContaining({ id: "org.example.alpha" }),
        installedAt: 200,
        fileCount: 2,
        byteSize: expect.any(Number),
      },
      {
        manifest: expect.objectContaining({ id: baseManifest.id }),
        installedAt: 100,
        fileCount: 2,
        byteSize: expect.any(Number),
      },
    ])

    const snapshot = await store.read(baseManifest.id)
    expect(snapshot?.files.map((file) => file.path)).toEqual(["index.js", "manifest.json"])

    await store.remove(baseManifest.id)
    expect(await store.read(baseManifest.id)).toBeUndefined()
    expect(await store.list()).toHaveLength(1)

    store.close()
    expect(backend.closed).toBe(true)
  })

  it("accepts Blob input", async () => {
    const backend = new MemoryBackend()
    const store = new PluginPackageStore({ backend })
    const archive = buildArchive()
    const snapshot = await store.install(new Blob([archive.slice().buffer]))
    expect(snapshot.manifest.id).toBe(baseManifest.id)
  })

  it("restores a previously validated snapshot", async () => {
    const backend = new MemoryBackend()
    const store = new PluginPackageStore({ backend })
    const first = await store.install(buildArchive({}, { version: "1.0.0" }))
    await store.install(buildArchive({}, { version: "2.0.0" }))
    await store.restore(first)
    expect((await store.read(baseManifest.id))?.manifest.version).toBe("1.0.0")
  })

  it("does not replace an installed package when a new package is invalid", async () => {
    const backend = new MemoryBackend()
    const store = new PluginPackageStore({ backend })
    await store.install(buildArchive({}, { version: "1.0.0" }))

    await expect(store.install(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "archive",
    })
    await expect(
      store.install(buildArchive({}, { version: "2.0.0", apiVersion: 2 }))
    ).rejects.toMatchObject({ code: "manifest" })
    await expect(
      store.install(buildArchive({ "index.js": null }, { version: "2.0.0" }))
    ).rejects.toMatchObject({ code: "missing-file" })
    await expect(
      store.install(buildArchive({ "../escape.js": "x" }, { version: "2.0.0" }))
    ).rejects.toMatchObject({ code: "path" })

    const snapshot = await store.read(baseManifest.id)
    expect(snapshot?.manifest.version).toBe("1.0.0")
  })

  it("keeps the previous package when the backend write fails", async () => {
    const backend = new MemoryBackend()
    const store = new PluginPackageStore({ backend })
    await store.install(buildArchive({}, { version: "1.0.0" }))

    backend.failPuts = true
    await expect(store.install(buildArchive({}, { version: "2.0.0" }))).rejects.toMatchObject({
      code: "storage",
    })

    const snapshot = await store.read(baseManifest.id)
    expect(snapshot?.manifest.version).toBe("1.0.0")
  })

  it("reports unavailable IndexedDB clearly", async () => {
    const store = new PluginPackageStore()
    const error = await store.read("anything").catch((cause: unknown) => cause)
    expect(error).toMatchObject({ name: "PluginPackageStoreError", code: "unavailable" })
  })
})
