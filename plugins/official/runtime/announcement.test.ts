import { afterEach, describe, expect, it, vi } from "vitest"
import {
  ConfiguredAnnouncementService,
  type AnnouncementStorage,
} from "./announcement"

function memoryStorage(): AnnouncementStorage {
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

describe("ConfiguredAnnouncementService", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fetches the configured document and filters expired, future and dismissed entries", async () => {
    const url = "https://announcements.example.test/feed.json"
    const storage = memoryStorage()
    const now = Date.parse("2026-03-01T12:00:00.000Z")
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        id: "a-1",
        title: "Maintenance",
        content: "Tonight",
        level: "warning",
        publishedAt: "2026-03-01T00:00:00.000Z",
        expireAt: "2026-03-02T00:00:00.000Z",
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const service = new ConfiguredAnnouncementService({
      endpoint: url,
      dismissedStorageKey: "test:dismissed",
      storage,
      now: () => now,
    })

    await expect(service.check()).resolves.toMatchObject({
      id: "a-1",
      title: "Maintenance",
      level: "warning",
    })
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )

    service.dismiss("a-1")
    expect(storage.getItem("test:dismissed")).toBe("a-1")
    await expect(service.check()).resolves.toBeNull()
  })

  it("ignores entries that are future-dated or already expired", async () => {
    const now = Date.parse("2026-03-01T12:00:00.000Z")
    const storage = memoryStorage()
    const responses = [
      {
        id: "future",
        title: "Future",
        content: "",
        level: "info",
        publishedAt: "2026-03-02T00:00:00.000Z",
      },
      {
        id: "expired",
        title: "Expired",
        content: "",
        level: "info",
        expireAt: "2026-03-01T00:00:00.000Z",
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(responses.shift()))
    )

    const service = new ConfiguredAnnouncementService({
      endpoint: "https://announcements.example.test/feed.json",
      storage,
      now: () => now,
    })
    await expect(service.check()).resolves.toBeNull()
    await expect(service.check()).resolves.toBeNull()
  })

  it("aborts in-flight checks and ignores later work after disposal", async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      const { promise, reject } = Promise.withResolvers<Response>()
      capturedSignal?.addEventListener("abort", () => reject(new Error("aborted")))
      return promise
    })
    vi.stubGlobal("fetch", fetchMock)

    const service = new ConfiguredAnnouncementService({
      endpoint: "https://announcements.example.test/feed.json",
      storage: memoryStorage(),
    })
    const pending = service.check()
    service.dispose()

    expect(capturedSignal?.aborted).toBe(true)
    await expect(pending).resolves.toBeNull()
    await expect(service.check()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not fetch when the composition configures no endpoint", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const service = new ConfiguredAnnouncementService({ storage: memoryStorage() })

    expect(service.endpoint).toBeNull()
    await expect(service.check()).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
