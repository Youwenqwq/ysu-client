import { afterEach, describe, expect, it, vi } from "vitest"
import { ConfiguredUpdateService, isNewer, type UpdateStorage } from "./service"

function memoryStorage(): UpdateStorage {
  const entries = new Map<string, string>()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("ConfiguredUpdateService", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("reads the manifest and bundle from the configured release base", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ webVersion: "1.2.0", body: "Release notes" })
    )
    vi.stubGlobal("fetch", fetchMock)

    const service = new ConfiguredUpdateService({
      releaseBaseUrl: "https://releases.example.test/latest/",
      currentVersion: "1.0.0",
      storage: memoryStorage(),
    })

    await expect(service.checkForUpdate()).resolves.toEqual({
      available: true,
      version: "1.2.0",
      downloadUrl: "https://releases.example.test/latest/dist.zip",
      body: "Release notes",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    })
    expect(fetchMock).toHaveBeenCalledWith("https://releases.example.test/latest/version.json")
  })

  it("only rewrites asset URLs whose origin the composition marks mirrorable", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        webVersion: "1.2.0",
        webDownloadUrl: "https://downloads.example.test/bundle.zip",
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const service = new ConfiguredUpdateService({
      releaseBaseUrl: "https://releases.example.test/latest",
      currentVersion: "1.0.0",
      mirrors: [
        { label: "Direct", value: "" },
        { label: "Mirror", value: "https://mirror.example.test/" },
      ],
      mirrorableOrigins: ["https://downloads.example.test"],
      storage: memoryStorage(),
    })

    expect(service.getMirrors()).toHaveLength(2)
    const mirrored = await service.checkForUpdate({ mirror: "https://mirror.example.test/" })
    expect(mirrored.downloadUrl).toBe(
      "https://mirror.example.test/https://downloads.example.test/bundle.zip"
    )

    const direct = await service.checkForUpdate()
    expect(direct.downloadUrl).toBe("https://downloads.example.test/bundle.zip")
  })

  it("leaves non-mirrorable asset origins untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          webVersion: "1.2.0",
          webDownloadUrl: "https://other.example.test/bundle.zip",
        })
      )
    )

    const service = new ConfiguredUpdateService({
      releaseBaseUrl: "https://releases.example.test/latest",
      currentVersion: "1.0.0",
      mirrorableOrigins: ["https://downloads.example.test"],
      storage: memoryStorage(),
    })

    await expect(
      service.checkForUpdate({ mirror: "https://mirror.example.test/" })
    ).resolves.toMatchObject({
      downloadUrl: "https://other.example.test/bundle.zip",
    })
  })

  it("applies the automatic-check cooldown without changing explicit checks", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ webVersion: "1.2.0" }))
    vi.stubGlobal("fetch", fetchMock)

    let now = 1_000_000
    const service = new ConfiguredUpdateService({
      releaseBaseUrl: "https://releases.example.test/latest",
      currentVersion: "1.0.0",
      checkCooldownMs: 60_000,
      checkCooldownStorageKey: "test:last-check",
      storage: memoryStorage(),
      now: () => now,
    })

    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now += 30_000
    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now += 60_000
    await expect(
      service.checkForUpdate({ automatic: true, channel: "stable" })
    ).resolves.toMatchObject({ available: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws for explicit check failures and folds automatic failures into an empty result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 403 }))
    )
    const service = new ConfiguredUpdateService({
      releaseBaseUrl: "https://releases.example.test/latest",
      currentVersion: "1.0.0",
      storage: memoryStorage(),
    })

    await expect(service.checkForUpdate()).rejects.toThrow("RATE_LIMIT")
    await expect(service.checkForUpdate({ automatic: true })).resolves.toMatchObject({
      available: false,
      version: "",
    })
  })

  it("compares versions per channel without accepting prereleases on stable", () => {
    expect(isNewer("1.0.0", "1.1.0")).toBe(true)
    expect(isNewer("1.1.0", "1.1.0")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-beta.1", "stable")).toBe(false)
    expect(isNewer("1.0.0", "1.1.0-beta.1", "prerelease")).toBe(true)
  })

  it("requires a configured base URL", () => {
    expect(
      () =>
        new ConfiguredUpdateService({
          releaseBaseUrl: "  ",
          currentVersion: "1.0.0",
          storage: memoryStorage(),
        })
    ).toThrow("release base URL")
  })
})
