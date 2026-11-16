import { afterEach, describe, expect, it, vi } from "vitest"
import { ConfiguredAnalyticsService, type AnalyticsStorage } from "./analytics"

function memoryStorage(): AnalyticsStorage {
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

describe("ConfiguredAnalyticsService", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("posts to the configured collector and dedupes once per UTC day", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    let now = new Date("2026-03-01T10:00:00.000Z")
    const service = new ConfiguredAnalyticsService({
      endpoint: "https://collector.example.test/events",
      storage: memoryStorage(),
      now: () => now,
    })

    await expect(
      service.track(
        { version: "1.2.3", platform: "web" },
        { enabled: true, oncePerDay: true, dedupeKey: "launch" }
      )
    ).resolves.toEqual({ tracked: true, reason: "sent", date: "2026-03-01" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith("https://collector.example.test/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: "1.2.3", platform: "web" }),
    })

    await expect(
      service.track({ version: "1.2.3" }, { enabled: true, oncePerDay: true, dedupeKey: "launch" })
    ).resolves.toEqual({ tracked: false, reason: "duplicate", date: "2026-03-01" })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    now = new Date("2026-03-02T00:00:01.000Z")
    await expect(
      service.track({ version: "1.2.3" }, { enabled: true, oncePerDay: true, dedupeKey: "launch" })
    ).resolves.toEqual({ tracked: true, reason: "sent", date: "2026-03-02" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("honours consent and stays inert when the composition configures no endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)

    const configured = new ConfiguredAnalyticsService({
      endpoint: "https://collector.example.test/events",
      storage: memoryStorage(),
    })
    await expect(
      configured.track({ version: "1.0.0" }, { enabled: false, oncePerDay: true })
    ).resolves.toEqual({ tracked: false, reason: "disabled", date: null })
    expect(fetchMock).not.toHaveBeenCalled()

    const unconfigured = new ConfiguredAnalyticsService({
      endpoint: "   ",
      storage: memoryStorage(),
    })
    expect(unconfigured.endpoint).toBeNull()
    await expect(
      unconfigured.track({ version: "1.0.0" }, { enabled: true, oncePerDay: true })
    ).resolves.toEqual({ tracked: false, reason: "unavailable", date: null })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("folds transport failures into the result without persisting the daily watch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline")
    })
    vi.stubGlobal("fetch", fetchMock)
    const storage = memoryStorage()
    const service = new ConfiguredAnalyticsService({
      endpoint: "https://collector.example.test/events",
      storage,
      now: () => new Date("2026-03-01T10:00:00.000Z"),
    })

    await expect(
      service.track({ version: "1.0.0" }, { enabled: true, oncePerDay: true, dedupeKey: "launch" })
    ).resolves.toEqual({ tracked: false, reason: "failed", date: null })
    expect(storage.getItem("orahako-analytics:launch")).toBeNull()
  })
})
