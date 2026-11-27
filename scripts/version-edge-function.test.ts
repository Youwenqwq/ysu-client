import { describe, expect, it } from "vitest"
import {
  onRequestGet as getAnnouncement,
  onRequestPost as postAnnouncement,
} from "../website/edge-functions/api/announcement.js"
import {
  onRequestGet as getVersion,
  onRequestPut as putVersion,
} from "../website/edge-functions/api/version.js"

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

describe("EdgeOne /api/version Edge Function", () => {
  const releaseToken = "release-secret-token-123456"

  it("enforces RELEASE_TOKEN auth, stores channels independently, and synthesizes the manifest with no-cache", async () => {
    const kv = createMemoryKv()
    const env = { STATS_KV: kv, RELEASE_TOKEN: releaseToken }

    // Empty state returns 404
    const emptyRes = await getVersion({ env })
    expect(emptyRes.status).toBe(404)
    expect(emptyRes.headers.get("cache-control")).toBe("no-cache")

    // Missing or wrong token returns 401
    const unauthRes = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: "stable" }),
      }),
      env,
    })
    expect(unauthRes.status).toBe(401)

    // Unconfigured token returns 403
    const unconfiguredRes = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({ channel: "stable" }),
      }),
      env: { STATS_KV: kv },
    })
    expect(unconfiguredRes.status).toBe(403)

    // Write stable channel
    const stablePut = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({
          channel: "stable",
          webVersion: "0.16.0",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/dist.zip",
          apkVersionCode: 1060099,
          apkDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/app-release-0.16.0.apk",
          body: "## 0.16.0",
        }),
      }),
      env,
    })
    expect(stablePut.status).toBe(200)

    // Write beta channel (web-only OTA without APK)
    const betaPut = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({
          channel: "beta",
          webVersion: "0.17.0-rc.1",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.17.0-rc.1/dist.zip",
          minApkVersionCode: 1060099,
          body: "## 0.17.0-rc.1",
        }),
      }),
      env,
    })
    expect(betaPut.status).toBe(200)

    // Write canary channel
    const canaryPut = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({
          channel: "canary",
          webVersion: "0.18.0-canary.1",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.18.0-canary.1/dist.zip",
          minApkVersionCode: 1060099,
          body: "## 0.18.0-canary.1",
        }),
      }),
      env,
    })
    expect(canaryPut.status).toBe(200)

    // Synthesized GET merges all three channels and flattens stable at top level
    const manifestRes = await getVersion({ env })
    expect(manifestRes.status).toBe(200)
    expect(manifestRes.headers.get("cache-control")).toBe("no-cache")
    const manifest = await manifestRes.json()
    expect(manifest).toEqual({
      webVersion: "0.16.0",
      webDownloadUrl:
        "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/dist.zip",
      apkVersionCode: 1060099,
      minApkVersionCode: 1060099,
      apkDownloadUrl:
        "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/app-release-0.16.0.apk",
      body: "## 0.16.0",
      channels: {
        stable: {
          webVersion: "0.16.0",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/dist.zip",
          apkVersionCode: 1060099,
          minApkVersionCode: 1060099,
          apkDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/app-release-0.16.0.apk",
          body: "## 0.16.0",
        },
        beta: {
          webVersion: "0.17.0-rc.1",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.17.0-rc.1/dist.zip",
          minApkVersionCode: 1060099,
          body: "## 0.17.0-rc.1",
        },
        canary: {
          webVersion: "0.18.0-canary.1",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.18.0-canary.1/dist.zip",
          minApkVersionCode: 1060099,
          body: "## 0.18.0-canary.1",
        },
      },
    })
  })

  it("validates payload fields strictly", async () => {
    const kv = createMemoryKv()
    const env = { STATS_KV: kv, RELEASE_TOKEN: releaseToken }

    const badStable = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({
          channel: "stable",
          webVersion: "0.16.0",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.16.0/dist.zip",
        }),
      }),
      env,
    })
    expect(badStable.status).toBe(400)

    const partialApk = await putVersion({
      request: new Request("https://orahako.welain.com/api/version", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${releaseToken}`,
        },
        body: JSON.stringify({
          channel: "beta",
          webVersion: "0.17.0-rc.1",
          webDownloadUrl:
            "https://github.com/Youwenqwq/orahako/releases/download/v0.17.0-rc.1/dist.zip",
          apkVersionCode: 1070051,
        }),
      }),
      env,
    })
    expect(partialApk.status).toBe(400)
  })
})

describe("EdgeOne /api/announcement Edge Function", () => {
  it("enforces site-active guard for public reads while allowing admin access", async () => {
    const kv = createMemoryKv()
    const env = { STATS_KV: kv, ADMIN_PASSWORD: "admin-secret" }

    const postRes = await postAnnouncement({
      request: new Request("https://orahako.welain.com/api/announcement", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer admin-secret",
        },
        body: JSON.stringify({
          id: "ann-1",
          title: "Notice",
          content: "Hello",
          level: "info",
        }),
      }),
      env,
    })
    expect(postRes.status).toBe(200)

    // Public read succeeds when site is active
    const publicOk = await getAnnouncement({
      request: new Request("https://orahako.welain.com/api/announcement"),
      env,
    })
    expect(publicOk.status).toBe(200)
    expect(publicOk.headers.get("cache-control")).toBe("no-cache")

    // Disable site in KV -> public read returns 404, admin read still succeeds
    await kv.put("site:status", JSON.stringify({ enabled: false }))
    const publicDisabled = await getAnnouncement({
      request: new Request("https://orahako.welain.com/api/announcement"),
      env,
    })
    expect(publicDisabled.status).toBe(404)

    const adminRead = await getAnnouncement({
      request: new Request("https://orahako.welain.com/api/announcement", {
        headers: { authorization: "Bearer admin-secret" },
      }),
      env,
    })
    expect(adminRead.status).toBe(200)
  })
})
