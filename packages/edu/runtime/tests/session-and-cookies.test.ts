import { describe, expect, it, vi } from "vitest"
import type { SessionSnapshot } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import {
  Context,
  createObservableSource,
  installCookies,
  type HttpRequest,
  type HttpResponse,
  type NetworkActivitySnapshot,
  type PluginHttpService,
  type PluginKeyValueStorage,
  type PluginStorageService,
} from "@orahako/sdk"
import {
  MAX_COOKIE_REDIRECTS,
  ScopedSessionService,
  sessionRuntimePlugin,
  SimpleCookieJar,
} from "../src"

function createMemoryStorage(): {
  service: PluginStorageService
  localMap: Map<string, string>
  secureMap: Map<string, string>
} {
  const localMap = new Map<string, string>()
  const secureMap = new Map<string, string>()

  const wrap = (store: Map<string, string>): PluginKeyValueStorage => ({
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value)
    },
    removeItem: async (key) => {
      store.delete(key)
    },
  })

  return {
    service: {
      local: wrap(localMap),
      secure: wrap(secureMap),
    },
    localMap,
    secureMap,
  }
}

function makeHttpResponse(
  status: number,
  url: string,
  headers: Record<string, string | string[]> = {},
  bodyText = ""
): HttpResponse {
  return {
    status,
    url,
    headers,
    text: async () => bodyText,
    arrayBuffer: async () => new TextEncoder().encode(bodyText).buffer,
  }
}

function createFakeHttp(handler: (req: HttpRequest) => Promise<HttpResponse> | HttpResponse): {
  http: PluginHttpService
  requests: HttpRequest[]
} {
  const requests: HttpRequest[] = []
  const activityState = createObservableSource<NetworkActivitySnapshot>({
    active: [],
    history: [],
    session: null,
    revision: 0,
  })
  const http: PluginHttpService = {
    send: async (req) => {
      requests.push(req)
      return handler(req)
    },
    activity: {
      state: activityState,
      getSnapshot: activityState.getSnapshot,
      subscribe: activityState.subscribe,
      beginRequest: () => () => {},
      registerLabeler: () => () => {},
      registerClassifier: () => () => {},
    },
  }
  return { http, requests }
}

describe("ScopedSessionService & sessionRuntimePlugin", () => {
  it("hydrates asynchronously from scoped storage, keeps secrets out of local storage, and preserves per-school isolation", async () => {
    const { service: storage, localMap, secureMap } = createMemoryStorage()
    const { http } = createFakeHttp(() => makeHttpResponse(200, "https://example.edu"))
    const ctx1 = new Context()

    const s1 = new ScopedSessionService({
      ctx: ctx1,
      storage,
      http,
      defaultSchoolId: "ysu",
    })

    expect(s1.getSnapshot().hasHydrated).toBe(false)
    expect(s1.getSnapshot().activeSchoolId).toBe("ysu")
    await s1.hydrated
    expect(s1.getSnapshot().hasHydrated).toBe(true)

    s1.setCredential({ schoolId: "ysu", credential: "ysu-tgc-secret", username: "202201" })
    s1.setArtifact("jwxt", '{"cookies":["gs1"]}')
    s1.setCredential({ schoolId: "zmu", credential: "zmu-tgc-secret", username: "zmu99" })
    s1.setArtifact("portal", "zmu-portal-token", "zmu")
    s1.activateSchool("ysu")

    // Writes are serialized asynchronously; wait for the full snapshot to land.
    await vi.waitFor(() => {
      const secureDump = secureMap.get("session-secrets") ?? ""
      expect(secureDump).toContain('"username":"202201"')
      expect(secureDump).toContain('"username":"zmu99"')
      expect(secureDump).toContain("gs1")
      expect(secureDump).toContain("zmu-portal-token")
      expect(localMap.get("session-meta") ?? "").toContain('"activeSchoolId":"ysu"')
    })

    // Secrets and session artifacts must live strictly in secure storage, never local storage!
    const localDump = JSON.stringify(Array.from(localMap.entries()))
    expect(localDump).not.toContain("ysu-tgc-secret")
    expect(localDump).not.toContain("gs1")

    s1.dispose()

    // Restart a new ScopedSessionService backed by the same storage and verify full hydration
    const ctx2 = new Context()
    const changedSnapshots: SessionSnapshot[] = []
    ctx2.on("session/changed", (snap) => changedSnapshots.push(snap))

    const s2 = new ScopedSessionService({ ctx: ctx2, storage, http })
    expect(s2.getSnapshot().hasHydrated).toBe(false)
    await s2.hydrated

    expect(s2.getSnapshot()).toEqual({
      activeSchoolId: "ysu",
      credential: "ysu-tgc-secret",
      username: "202201",
      isAuthenticated: true,
      sessionExpired: false,
      hasHydrated: true,
      artifacts: { jwxt: '{"cookies":["gs1"]}' },
    })
    expect(changedSnapshots.at(-1)?.hasHydrated).toBe(true)

    s2.activateSchool("zmu")
    expect(s2.getSnapshot()).toMatchObject({
      activeSchoolId: "zmu",
      credential: "zmu-tgc-secret",
      username: "zmu99",
      isAuthenticated: true,
      artifacts: { portal: "zmu-portal-token" },
    })

    // Updating credential resets old artifacts for that school only
    s2.setCredential({ schoolId: "zmu", credential: "zmu-fresh", username: "zmu99" })
    expect(s2.getArtifact("portal", "zmu")).toBeNull()
    expect(s2.getArtifact("jwxt", "ysu")).toBe('{"cookies":["gs1"]}')

    // Clearing inactive school leaves active school untouched
    s2.clearCredential("ysu")
    expect(s2.getSnapshot().credential).toBe("zmu-fresh")
    s2.activateSchool("ysu")
    expect(s2.getSnapshot().isAuthenticated).toBe(false)
    expect(s2.getSnapshot().credential).toBeNull()

    s2.dispose()
  })

  it("serializes full snapshot writes so a slow older write cannot overwrite newer state", async () => {
    const localMap = new Map<string, string>()
    const secureMap = new Map<string, string>()
    const secureWrites: string[] = []
    const firstWriteGate = Promise.withResolvers<void>()

    const { http } = createFakeHttp(() => makeHttpResponse(200, "https://example.edu"))
    const storage: PluginStorageService = {
      local: {
        getItem: async (key) => localMap.get(key) ?? null,
        setItem: async (key, value) => {
          localMap.set(key, value)
        },
        removeItem: async (key) => {
          localMap.delete(key)
        },
      },
      secure: {
        getItem: async (key) => secureMap.get(key) ?? null,
        setItem: async (key, value) => {
          secureWrites.push(value)
          if (secureWrites.length === 1) await firstWriteGate.promise
          secureMap.set(key, value)
        },
        removeItem: async (key) => {
          secureMap.delete(key)
        },
      },
    }

    const service = new ScopedSessionService({
      ctx: new Context(),
      storage,
      http,
      defaultSchoolId: "ysu",
    })
    await service.hydrated

    service.setArtifact("token", "first")
    service.setArtifact("token", "second")

    await vi.waitFor(() => expect(secureWrites).toHaveLength(1))
    // The second snapshot must wait for the first write instead of racing it.
    expect(secureWrites).toHaveLength(1)

    firstWriteGate.resolve()
    await vi.waitFor(() => expect(secureWrites).toHaveLength(2))
    const persisted = JSON.parse(secureMap.get("session-secrets") ?? "{}") as {
      artifactsBySchool?: Record<string, Record<string, string>>
    }
    expect(persisted.artifactsBySchool?.ysu?.token).toBe("second")

    service.dispose()
  })

  it("preserves pre-hydration mutations made before slow storage resolves", async () => {
    const gates = Promise.withResolvers<string | null>()
    const storage: PluginStorageService = {
      local: {
        getItem: async () => JSON.stringify({ version: 1, activeSchoolId: "old-school" }),
        setItem: async () => {},
        removeItem: async () => {},
      },
      secure: {
        getItem: () => gates.promise,
        setItem: async () => {},
        removeItem: async () => {},
      },
    }
    const { http } = createFakeHttp(() => makeHttpResponse(200, "https://example.edu"))
    const service = new ScopedSessionService({ ctx: new Context(), storage, http })

    // Mutate BEFORE secure storage finishes hydrating
    service.setCredential({ schoolId: "new-school", credential: "fresh-token", username: "alice" })
    expect(service.getSnapshot()).toMatchObject({
      activeSchoolId: "new-school",
      credential: "fresh-token",
      hasHydrated: false,
    })

    gates.resolve(
      JSON.stringify({
        version: 1,
        credentialsBySchool: {
          "old-school": { credential: "old-token", username: "bob" },
          "new-school": { credential: "stale-token", username: "stale" },
        },
        artifactsBySchool: {},
      })
    )
    await service.hydrated

    expect(service.getSnapshot()).toMatchObject({
      activeSchoolId: "new-school",
      credential: "fresh-token",
      username: "alice",
      isAuthenticated: true,
      hasHydrated: true,
    })

    // Old school from storage was also preserved because it was not cleared
    service.activateSchool("old-school")
    expect(service.getSnapshot().credential).toBe("old-token")
    service.dispose()
  })

  it("separates isAuthenticated from sessionExpired and emits session/expired only on false -> true transition", async () => {
    const { service: storage } = createMemoryStorage()
    const { http } = createFakeHttp(() => makeHttpResponse(200, "https://example.edu"))
    const runtime = new PluginRuntime()
    runtime.context.set("storage", storage)
    runtime.context.set("http", http)

    const changedEvents: SessionSnapshot[] = []
    const expiredEvents: SessionSnapshot[] = []
    runtime.context.on("session/changed", (snap) => changedEvents.push(snap))
    runtime.context.on("session/expired", (snap) => expiredEvents.push(snap))

    runtime.register(sessionRuntimePlugin, "builtin", { defaultSchoolId: "ysu" })
    await runtime.startAndWait(sessionRuntimePlugin.manifest.id)

    const session = runtime.context.get("session")!
    session.setCredential({ schoolId: "ysu", credential: "tgc-1", username: "202201" })
    expect(expiredEvents).toHaveLength(0)

    // Transition false -> true: preserves isAuthenticated=true & credential, emits session/expired once
    session.setSessionExpired(true)
    expect(session.getSnapshot()).toMatchObject({
      isAuthenticated: true,
      credential: "tgc-1",
      username: "202201",
      sessionExpired: true,
    })
    expect(expiredEvents).toHaveLength(1)

    // Idempotent true -> true: emits neither session/changed nor session/expired
    const changedCountBefore = changedEvents.length
    session.setSessionExpired(true)
    expect(changedEvents).toHaveLength(changedCountBefore)
    expect(expiredEvents).toHaveLength(1)

    // Transition true -> false: emits session/changed but NOT session/expired
    session.setSessionExpired(false)
    expect(session.getSnapshot().sessionExpired).toBe(false)
    expect(session.getSnapshot().isAuthenticated).toBe(true)
    expect(changedEvents).toHaveLength(changedCountBefore + 1)
    expect(expiredEvents).toHaveLength(1)

    runtime.dispose()
  })
})

describe("SimpleCookieJar & fetchWithJar redirect loop", () => {
  it("matches RFC 6265 paths/domains, handles Max-Age=0 deletion without shadowing shorter paths, and round-trips JSON", async () => {
    const jar = new SimpleCookieJar()
    await jar.setCookie(
      "CASTGC=real-tgc; Path=/authserver; Secure; HttpOnly",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    // Server clearing cookie on a longer sub-path must NOT shadow real-tgc!
    await jar.setCookie(
      "CASTGC=; Max-Age=0; Path=/authserver/; HttpOnly",
      "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do"
    )
    expect(
      await jar.getCookieString(
        "https://cer.ysu.edu.cn/authserver/dynamicCode/getDynamicCodeByReauth.do"
      )
    ).toBe("CASTGC=real-tgc")

    // Secure cookies are withheld on non-https URLs
    expect(await jar.getCookieString("http://cer.ysu.edu.cn/authserver/login")).toBe("")

    // Longest path wins when same cookie name exists on two valid paths
    await jar.setCookie("GS_SESSIONID=root; Path=/", "https://jwxt.ysu.edu.cn/")
    await jar.setCookie(
      "GS_SESSIONID=nested; Path=/jwapp/",
      "https://jwxt.ysu.edu.cn/jwapp/sys/index.do"
    )
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapp/sys/index.do")).toBe(
      "GS_SESSIONID=nested"
    )

    // Serialization roundtrip
    const restored = SimpleCookieJar.fromJSON(jar.toJSON())
    expect(await restored.getCookieString("https://jwxt.ysu.edu.cn/jwapp/sys/index.do")).toBe(
      "GS_SESSIONID=nested"
    )

    // Same-path Max-Age=0 deletes existing entry
    await restored.setCookie(
      "GS_SESSIONID=; Max-Age=0; Path=/jwapp/",
      "https://jwxt.ysu.edu.cn/jwapp/sys/index.do"
    )
    expect(await restored.getCookieString("https://jwxt.ysu.edu.cn/jwapp/sys/index.do")).toBe(
      "GS_SESSIONID=root"
    )
  })

  it("captures intermediate 302 Set-Cookie headers across hops via ctx.http.send and converts POST -> GET on 302 while preserving POST on 307", async () => {
    const { service: storage } = createMemoryStorage()
    const { http, requests } = createFakeHttp(async (req) => {
      // Every hop must instruct underlying http.send NOT to auto-follow redirects
      expect(req.redirect).toBe("manual")

      if (req.url === "https://cer.ysu.edu.cn/authserver/login") {
        expect(req.method).toBe("POST")
        expect(req.body).toBe("username=202201&password=enc")
        return makeHttpResponse(302, req.url, {
          "Set-Cookie":
            "CASTGC=tgc-hop1; Path=/authserver; Secure, route=cas1; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/",
          Location: "https://jwxt.ysu.edu.cn/jwapp/login?ticket=ST-123",
        })
      }

      if (req.url === "https://jwxt.ysu.edu.cn/jwapp/login?ticket=ST-123") {
        // 302 after POST must convert to GET and strip body + Content-Type
        expect(req.method).toBe("GET")
        expect(req.body).toBeUndefined()
        expect(req.headers?.["Content-Type"]).toBeUndefined()
        // CASTGC is scoped to cer.ysu.edu.cn, must not leak to jwxt.ysu.edu.cn
        expect(req.headers?.Cookie ?? "").not.toContain("CASTGC")
        return makeHttpResponse(302, req.url, {
          "set-cookie": ["GS_SESSIONID=jwxt-hop2; Path=/jwapp/", "_WEU=weu-hop2; Path=/jwapp/"],
          location: "/jwapp/sys/emaphome/portal/index.do",
        })
      }

      if (req.url === "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do") {
        expect(req.method).toBe("GET")
        expect(req.headers?.Cookie).toContain("GS_SESSIONID=jwxt-hop2")
        expect(req.headers?.Cookie).toContain("_WEU=weu-hop2")
        return makeHttpResponse(200, req.url, {}, "welcome-portal")
      }

      if (req.url === "https://api.ysu.edu.cn/v1/submit") {
        return makeHttpResponse(307, req.url, {
          Location: "https://api.ysu.edu.cn/v2/submit",
        })
      }

      if (req.url === "https://api.ysu.edu.cn/v2/submit") {
        // 307 must preserve POST method, body, and Content-Type!
        expect(req.method).toBe("POST")
        expect(req.body).toBe('{"ok":true}')
        expect(req.headers?.["Content-Type"]).toBe("application/json")
        return makeHttpResponse(200, req.url, {}, "submitted-v2")
      }

      throw new Error(`Unexpected URL: ${req.url}`)
    })

    const session = new ScopedSessionService({ ctx: new Context(), storage, http })
    const jar = session.createCookieJar()

    const portalResp = await session.fetchWithJar(jar, {
      method: "POST",
      url: "https://cer.ysu.edu.cn/authserver/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=202201&password=enc",
      redirect: "follow",
    })

    expect(portalResp.status).toBe(200)
    expect(await portalResp.text()).toBe("welcome-portal")
    expect(requests).toHaveLength(3)
    expect(await jar.getCookieString("https://cer.ysu.edu.cn/authserver/login")).toContain(
      "CASTGC=tgc-hop1"
    )
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapp/sys/index.do")).toBe(
      "GS_SESSIONID=jwxt-hop2; _WEU=weu-hop2"
    )

    // Verify 307 preserves POST + body + Content-Type
    const post307Resp = await session.fetchWithJar(jar, {
      method: "POST",
      url: "https://api.ysu.edu.cn/v1/submit",
      headers: { "Content-Type": "application/json" },
      body: '{"ok":true}',
      redirect: "follow",
    })
    expect(await post307Resp.text()).toBe("submitted-v2")

    session.dispose()
  })

  it("drops Authorization on cross-origin redirects and recomputes cookie scope", async () => {
    const { service: storage } = createMemoryStorage()
    const { http, requests } = createFakeHttp((req) => {
      if (req.url === "https://jwxt.ysu.edu.cn/auth") {
        expect(req.method).toBe("POST")
        expect(req.headers?.Authorization).toBe("Bearer secret")
        expect(req.headers?.Cookie).toBe("SSO=school")
        return makeHttpResponse(302, req.url, {
          Location: "https://evil.example/landing",
        })
      }
      if (req.url === "https://evil.example/landing") {
        expect(req.method).toBe("GET")
        expect(req.body).toBeUndefined()
        expect(req.headers?.Authorization).toBeUndefined()
        expect(req.headers?.["Proxy-Authorization"]).toBeUndefined()
        expect(req.headers?.["Content-Type"]).toBeUndefined()
        expect(req.headers?.Cookie).toBeUndefined()
        return makeHttpResponse(200, req.url, {}, "landed")
      }
      throw new Error(`Unexpected URL: ${req.url}`)
    })

    const session = new ScopedSessionService({ ctx: new Context(), storage, http })
    const jar = session.createCookieJar()
    await jar.setCookie("SSO=school; Domain=.ysu.edu.cn; Path=/", "https://cer.ysu.edu.cn/")

    const resp = await session.fetchWithJar(jar, {
      method: "POST",
      url: "https://jwxt.ysu.edu.cn/auth",
      headers: {
        Authorization: "Bearer secret",
        "Proxy-Authorization": "Basic proxy",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "a=1",
      redirect: "follow",
    })

    expect(resp.status).toBe(200)
    expect(await resp.text()).toBe("landed")
    expect(requests).toHaveLength(2)
    session.dispose()
  })

  it("isolates request-scoped cookies and enforces maxRedirects = 10", async () => {
    const { service: storage } = createMemoryStorage()
    let hopCounter = 0
    const { http } = createFakeHttp((req) => {
      if (req.url.startsWith("https://loop.ysu.edu.cn/")) {
        hopCounter += 1
        return makeHttpResponse(302, req.url, {
          Location: `https://loop.ysu.edu.cn/step-${hopCounter}`,
        })
      }
      return makeHttpResponse(200, req.url, {
        "set-cookie": ["_WEU=overwritten-by-server; Path=/", "SHARED=kept; Path=/"],
      })
    })

    const session = new ScopedSessionService({ ctx: new Context(), storage, http })
    const jar = session.createCookieJar()
    await jar.setCookie("_WEU=original; Path=/", "https://jwxt.ysu.edu.cn/")

    await session.fetchWithJar(jar, {
      method: "GET",
      url: "https://jwxt.ysu.edu.cn/jwapp/app.do",
      redirect: "manual",
      cookies: [
        {
          name: "_WEU",
          value: "scoped-app",
          domain: "jwxt.ysu.edu.cn",
          path: "/",
          secure: true,
          expires: null,
        },
      ],
    })

    // Request-scoped _WEU response Set-Cookie must NOT overwrite jar's original _WEU!
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapp/app.do")).toBe(
      "_WEU=original; SHARED=kept"
    )

    // Exceeding MAX_COOKIE_REDIRECTS (10) throws cleanly after 11 requests (initial + 10 hops)
    await expect(
      session.fetchWithJar(jar, {
        method: "GET",
        url: "https://loop.ysu.edu.cn/start",
        redirect: "follow",
      })
    ).rejects.toThrow(`Exceeded max redirects (${MAX_COOKIE_REDIRECTS})`)
    expect(hopCounter).toBe(MAX_COOKIE_REDIRECTS + 1)

    session.dispose()
  })

  it("preserves host-only cookies in installCookies and replaces/deletes across leading-dot domain variants", async () => {
    const jar = new SimpleCookieJar()

    // Simulate legacy persisted cookie stored with a leading-dot domain
    await installCookies(jar, [
      {
        name: "JSESSIONID",
        value: "stale-sid",
        domain: ".jwxt.ysu.edu.cn",
        path: "/jwmobile",
        secure: false,
        expires: null,
      },
      {
        name: "HOST_ONLY",
        value: "v1",
        domain: "jwxt.ysu.edu.cn",
        path: "/jwmobile",
        secure: false,
        expires: null,
      },
    ])

    // Host-only cookie must stay host-only (no leading dot) and not match sibling subdomains
    const allAfterInstall = await jar.getAllCookies()
    expect(allAfterInstall.find((c) => c.name === "HOST_ONLY")?.domain).toBe("jwxt.ysu.edu.cn")
    expect(await jar.getCookieString("https://sub.jwxt.ysu.edu.cn/jwmobile/auth/index")).not.toContain(
      "HOST_ONLY"
    )

    // Server issuing a host-only JSESSIONID must replace the legacy leading-dot entry, not be shadowed by it
    await jar.setCookie(
      "JSESSIONID=fresh-sid; Path=/jwmobile; HttpOnly",
      "https://jwxt.ysu.edu.cn/jwmobile/auth/index?ticket=ST-1"
    )
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwmobile/auth/index")).toBe(
      "HOST_ONLY=v1; JSESSIONID=fresh-sid"
    )

    // Max-Age=0 without Domain must also delete an existing leading-dot entry on the same host & path
    await jar.setCookie(
      "Authorization=old-jwt; Domain=jwxt.ysu.edu.cn; Path=/jwmobile; Secure",
      "https://jwxt.ysu.edu.cn/jwmobile/"
    )
    await jar.setCookie(
      "Authorization=; Max-Age=0; Path=/jwmobile",
      "https://jwxt.ysu.edu.cn/jwmobile/auth/index"
    )
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwmobile/biz/v410/")).not.toContain(
      "Authorization"
    )
  })
})
