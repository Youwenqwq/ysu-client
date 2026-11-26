import { describe, expect, it } from "vitest"
import { onRequest } from "../website/edge-functions/api/share.js"

function createMemoryKv() {
  const map = new Map<string, string>()
  return {
    async get(key: string, type?: string) {
      const val = map.get(key)
      if (val === undefined) return null
      return type === "json" ? JSON.parse(val) : val
    },
    async put(key: string, value: string) {
      map.set(key, value)
    },
    async delete(key: string) {
      map.delete(key)
    },
  }
}

describe("EdgeOne /api/share Edge Function", () => {
  const shareId = "shareId1234567890abcd"
  const writeToken = "ABCDEFGH1234567890abcdef12345678"
  const samplePayload = {
    version: 1,
    title: "2026-2027-1 日程",
    busyOnly: false,
    semester: "2026-2027-1",
    termStartDate: "2026-09-07",
    totalWeeks: 20,
    periods: [{ section: 1, startTime: "08:00", endTime: "08:45" }],
    items: [
      {
        title: "高等数学",
        location: "四教 201",
        category: "course",
        weekDay: 1,
        weekList: [1, 2, 3],
        startSection: 1,
        endSection: 2,
      },
    ],
    createdAt: 1700000000000,
  }

  it("publishes, serves JSON with noindex, enforces writeToken & size limits, and deletes cleanly", async () => {
    const kv = createMemoryKv()
    const env = { CALENDAR_KV: kv }

    const putRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/share", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({
          shareId,
          writeToken,
          ttlSeconds: 86400 * 7,
          payload: samplePayload,
        }),
      }),
      env,
    })
    expect(putRes.status).toBe(200)
    const putBody = (await putRes.json()) as { ok: boolean; expiresAt: number }
    expect(putBody.ok).toBe(true)
    expect(putBody.expiresAt).toBeGreaterThan(Date.now())

    const getRes = await onRequest({
      request: new Request(`https://ysu.welain.com/api/share?id=${shareId}`, {
        method: "GET",
      }),
      env,
    })
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get("x-robots-tag")).toBe("noindex, nofollow")
    const getBody = (await getRes.json()) as { payload: typeof samplePayload }
    expect(getBody.payload.title).toBe("2026-2027-1 日程")
    expect(getBody.payload.items).toHaveLength(1)

    const badPutRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/share", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({
          shareId,
          writeToken: "WRONG_TOKEN_12345678901234567890",
          payload: samplePayload,
        }),
      }),
      env,
    })
    expect(badPutRes.status).toBe(403)

    const oversizedRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/share", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({
          shareId: "oversizedId1234567890",
          writeToken,
          payload: {
            ...samplePayload,
            items: [{ title: "x".repeat(70_000), category: "course", weekDay: 1 }],
          },
        }),
      }),
      env,
    })
    expect(oversizedRes.status).toBe(413)

    const delRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/share", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({ shareId, writeToken }),
      }),
      env,
    })
    expect(delRes.status).toBe(200)

    const missingRes = await onRequest({
      request: new Request(`https://ysu.welain.com/api/share?id=${shareId}`, {
        method: "GET",
      }),
      env,
    })
    expect(missingRes.status).toBe(404)
  })
})
