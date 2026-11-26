import { describe, expect, it } from "vitest"
import { onRequest } from "../website/edge-functions/api/calendar.js"

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

describe("EdgeOne /api/calendar Edge Function", () => {
  const sampleIcs =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Orahako//Schedule//CN\r\nEND:VCALENDAR\r\n"
  const readToken = "abcdefghijklmnopqrstuvwxyz123456"
  const writeToken = "ABCDEFGH1234567890abcdef12345678"

  it("publishes, serves text/calendar, enforces writeToken ownership, and deletes cleanly", async () => {
    const kv = createMemoryKv()
    const env = { CALENDAR_KV: kv }

    const putRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/calendar", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({ readToken, writeToken, ics: sampleIcs }),
      }),
      env,
    })
    expect(putRes.status).toBe(200)

    const getRes = await onRequest({
      request: new Request(`https://ysu.welain.com/api/calendar?token=${readToken}`, {
        method: "GET",
      }),
      env,
    })
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get("content-type")).toBe("text/calendar; charset=utf-8")
    expect(await getRes.text()).toBe(sampleIcs)

    const badPutRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/calendar", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({
          readToken,
          writeToken: "WRONG_TOKEN_12345678901234567890",
          ics: sampleIcs,
        }),
      }),
      env,
    })
    expect(badPutRes.status).toBe(403)

    const delRes = await onRequest({
      request: new Request("https://ysu.welain.com/api/calendar", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://ysu.welain.com",
        },
        body: JSON.stringify({ readToken, writeToken }),
      }),
      env,
    })
    expect(delRes.status).toBe(200)

    const missingRes = await onRequest({
      request: new Request(`https://ysu.welain.com/api/calendar?token=${readToken}`, {
        method: "GET",
      }),
      env,
    })
    expect(missingRes.status).toBe(404)
  })
})
