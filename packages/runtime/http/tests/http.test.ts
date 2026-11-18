import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const capacitorMocks = vi.hoisted(() => ({
  isNative: false,
  request: vi.fn(),
}))

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorMocks.isNative,
  },
  CapacitorHttp: {
    request: capacitorMocks.request,
  },
  registerPlugin: () => ({}),
}))

import { PluginRuntime } from "@orahako/kernel"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type HttpRequest,
  type HttpResponse,
  type PluginHttpService,
} from "@orahako/sdk"
import {
  collectCookies,
  cookieEntryFromJSON,
  fetchWithCookieJar,
  HttpActivityRecorder,
  httpRuntimePlugin,
  installCookies,
  SimpleCookieJar,
} from "../src/index"

function encodeProxySetCookie(cookies: readonly string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cookies))
  let bin = ""
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin)
}

describe("SimpleCookieJar", () => {
  it("matches domain, path, secure, and expiry rules with longest-path deduplication", async () => {
    const jar = new SimpleCookieJar()
    await jar.setCookie("GS_SESSIONID=root-val; Path=/", "https://jwxt.ysu.edu.cn/")
    await jar.setCookie(
      "GS_SESSIONID=jwapp-val; Path=/jwapp/; Secure; HttpOnly",
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do"
    )
    await jar.setCookie(
      "SSO=shared; Domain=ysu.edu.cn; Path=/",
      "https://cer.ysu.edu.cn/authserver/login"
    )

    // Longest path (/jwapp/) wins over (/)
    const jwappHeader = await jar.getCookieString(
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do"
    )
    expect(jwappHeader).toBe("GS_SESSIONID=jwapp-val; SSO=shared")

    // Secure cookie is withheld on plain http://
    const insecureHeader = await jar.getCookieString(
      "http://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do"
    )
    expect(insecureHeader).toBe("GS_SESSIONID=root-val; SSO=shared")

    // Prefix boundary check: /jwapp does NOT match /jwapple when cookiePath is /jwapp
    await jar.setCookie("BOUND=1; Path=/jwapp", "https://jwxt.ysu.edu.cn/jwapp")
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapp/test")).toContain("BOUND=1")
    expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapple")).not.toContain("BOUND=1")
  })

  it("deletes cookies on Max-Age=0 without leaving empty zombie shadows and round-trips JSON", async () => {
    const jar = new SimpleCookieJar()
    await jar.setCookie(
      "CASTGC=real-tgc; Path=/authserver; HttpOnly",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    await jar.setCookie(
      "CASTGC=; Max-Age=0; Path=/authserver/; HttpOnly",
      "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do"
    )
    expect(
      await jar.getCookieString("https://cer.ysu.edu.cn/authserver/dynamicCode/getDynamicCode.do")
    ).toBe("CASTGC=real-tgc")

    // Exact path Max-Age=0 deletes the cookie
    await jar.setCookie(
      "CASTGC=; Max-Age=0; Path=/authserver",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    expect(await jar.getCookieString("https://cer.ysu.edu.cn/authserver/login")).toBe("")

    // Serialization + collectCookies + installCookies round-trip
    await jar.setCookie(
      "SID=xyz; Domain=.ysu.edu.cn; Path=/; Max-Age=3600; Secure",
      "https://cer.ysu.edu.cn/"
    )
    const restored = SimpleCookieJar.fromJSON(jar.toJSON())
    expect(await restored.getCookieString("https://jwxt.ysu.edu.cn/")).toBe("SID=xyz")

    const collected = await collectCookies(restored, (entry) => entry.name === "SID")
    expect(collected).toHaveLength(1)
    const targetJar = new SimpleCookieJar()
    await installCookies(targetJar, collected)
    expect(await targetJar.getCookieString("https://cer.ysu.edu.cn/")).toBe("SID=xyz")

    expect(() => cookieEntryFromJSON({ value: "missing-name" })).toThrow(TypeError)
  })
})

describe("httpRuntimePlugin waterfall pipeline, proxy & native transports, and fetchWithCookieJar", () => {
  beforeEach(() => {
    capacitorMocks.isNative = false
    capacitorMocks.request.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("chains http/request and http/response waterfalls in registration order and cleans up stopped interceptors", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const token = headers.get("x-activation")
      if (token !== "valid-token") {
        return new Response(JSON.stringify({ code: "ACTIVATION_REQUIRED" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("upstream-ok", {
        status: 200,
        headers: { "x-proxy-status": "200", "x-upstream": headers.get("x-trace") ?? "" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const runtime = new PluginRuntime()
    const order: string[] = []
    let activationToken: string | null = "stale-token"
    let consumerHttp!: PluginHttpService

    const uaInterceptor = definePlugin({
      manifest: {
        id: "plugin.ua",
        name: "Custom UA",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      apply(ctx) {
        ctx.on("http/request", (req) => {
          order.push("req:ua")
          return {
            ...req,
            headers: {
              ...req.headers,
              "User-Agent": "OrahakoCustom/3.0",
              "x-trace": "step1",
            },
          }
        })
      },
    })

    const activationInterceptor = definePlugin({
      manifest: {
        id: "plugin.activation",
        name: "Web Activation",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      apply(ctx) {
        ctx.on("http/request", async (req) => {
          order.push("req:activation")
          return {
            ...req,
            headers: {
              ...req.headers,
              "x-trace": `${req.headers?.["x-trace"] ?? ""}+step2`,
              ...(activationToken ? { "x-activation": activationToken } : {}),
            },
          }
        })
        ctx.on("http/response", async (resp, effectiveReq) => {
          order.push(`res:activation:${resp.status}:${effectiveReq.headers?.["x-trace"]}`)
          if (resp.status === 401 || resp.status === 403) {
            const detail = await resp.text()
            if (detail.includes("ACTIVATION_REQUIRED")) {
              activationToken = null
            }
          }
          return undefined
        })
      },
    })

    const transformInterceptor = definePlugin({
      manifest: {
        id: "plugin.transform",
        name: "Response Transform",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      apply(ctx) {
        ctx.on("http/response", (resp): HttpResponse => {
          order.push("res:transform")
          return {
            ...resp,
            headers: { ...resp.headers, "x-transformed": "yes" },
          }
        })
      },
    })

    const consumer = definePlugin({
      manifest: {
        id: "plugin.consumer",
        name: "Consumer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        consumerHttp = ctx.http
      },
    })

    try {
      runtime.register(httpRuntimePlugin, "builtin", { proxyPath: "/custom/proxy" })
      runtime.register(uaInterceptor, "builtin")
      runtime.register(activationInterceptor, "builtin")
      runtime.register(transformInterceptor, "builtin")
      runtime.register(consumer, "builtin")

      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(uaInterceptor.manifest.id)
      await runtime.startAndWait(activationInterceptor.manifest.id)
      await runtime.startAndWait(transformInterceptor.manifest.id)
      await runtime.startAndWait(consumer.manifest.id)

      // 1st call: stale token -> 403 -> activationInterceptor clears token, body remains readable
      const forbiddenResp = await consumerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/test#frag",
        redirect: "manual",
        proxyTargetInHeader: true,
      })

      expect(forbiddenResp.status).toBe(403)
      expect(activationToken).toBeNull()
      expect(forbiddenResp.headers["x-transformed"]).toBe("yes")
      expect(await forbiddenResp.text()).toContain("ACTIVATION_REQUIRED")
      expect(order).toEqual([
        "req:ua",
        "req:activation",
        "res:activation:403:step1+step2",
        "res:transform",
      ])

      const [firstUrl, firstInit] = fetchMock.mock.calls[0]!
      expect(String(firstUrl)).toBe("/custom/proxy")
      const firstHeaders = new Headers(firstInit?.headers)
      expect(firstHeaders.get("x-proxy-target")).toBe("https://jwxt.ysu.edu.cn/jwapp/test")
      expect(firstHeaders.get("x-proxy-manual-redirect")).toBe("1")
      expect(firstHeaders.get("x-proxy-ua")).toBe("OrahakoCustom/3.0")
      expect(firstHeaders.get("x-activation")).toBe("stale-token")

      // Stop transformInterceptor and set valid token -> verify disposed listener no longer runs
      runtime.stop(transformInterceptor.manifest.id)
      activationToken = "valid-token"
      order.length = 0

      const okResp = await consumerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/jwapp/ok",
        redirect: "manual",
      })
      expect(okResp.status).toBe(200)
      expect(okResp.headers["x-transformed"]).toBeUndefined()
      expect(await okResp.text()).toBe("upstream-ok")
      expect(order).toEqual(["req:ua", "req:activation", "res:activation:200:step1+step2"])
    } finally {
      runtime.dispose()
    }
  })

  it("captures intermediate 302 Set-Cookie headers across redirect hops in fetchWithCookieJar while invoking waterfalls and activity", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "x-proxy-status": "302",
            location: "https://jwxt.ysu.edu.cn/login?ticket=ST-1",
            "x-proxy-set-cookie": encodeProxySetCookie([
              "CASTGC=TGT-abc; Path=/authserver; Secure; HttpOnly",
            ]),
          },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "x-proxy-status": "302",
            location: "/jwapp/home.do",
            "x-proxy-set-cookie": encodeProxySetCookie([
              "GS_SESSIONID=JWXT-999; Path=/jwapp/; Secure; HttpOnly",
              "_WEU=from-server; Path=/jwapp/",
            ]),
          },
        })
      )
      .mockResolvedValueOnce(
        new Response("portal-ready", {
          status: 200,
          headers: { "x-proxy-status": "200" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const runtime = new PluginRuntime()
    let http!: PluginHttpService
    const seenUrls: string[] = []

    const probe = definePlugin({
      manifest: {
        id: "plugin.session-probe",
        name: "Session Probe",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        http = ctx.http
        ctx.on("http/request", (req) => {
          seenUrls.push(`${req.method} ${req.url}`)
          return undefined
        })
      },
    })

    try {
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(probe, "builtin")
      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(probe.manifest.id)

      const jar = new SimpleCookieJar()
      const finalResp = await fetchWithCookieJar(http, jar, {
        method: "POST",
        url: "https://cer.ysu.edu.cn/authserver/login",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "IGNORES_MANUAL=1",
        },
        body: "username=u&password=p",
        redirect: "follow",
        cookies: [
          {
            name: "_WEU",
            value: "scoped-app",
            domain: "jwxt.ysu.edu.cn",
            path: "/jwapp/",
            secure: true,
            expires: null,
          },
        ],
      })

      expect(finalResp.status).toBe(200)
      expect(await finalResp.text()).toBe("portal-ready")

      // POST converted to GET on 302, relative Location resolved against hop 2 host
      expect(seenUrls).toEqual([
        "POST https://cer.ysu.edu.cn/authserver/login",
        "GET https://jwxt.ysu.edu.cn/login?ticket=ST-1",
        "GET https://jwxt.ysu.edu.cn/jwapp/home.do",
      ])

      // Hop 1 must not send _WEU scoped to jwxt.ysu.edu.cn or manual Cookie header
      const hop0Headers = new Headers(fetchMock.mock.calls[0]![1]?.headers)
      expect(hop0Headers.get("x-proxy-cookie")).toBeNull()

      // Hop 3 sends GS_SESSIONID from hop 2 + scoped _WEU override, and strips Content-Type
      const hop2Headers = new Headers(fetchMock.mock.calls[2]![1]?.headers)
      expect(hop2Headers.get("x-proxy-cookie")).toBe("GS_SESSIONID=JWXT-999; _WEU=scoped-app")
      expect(hop2Headers.get("content-type")).toBeNull()

      // Shared jar captured both CASTGC and GS_SESSIONID, but NOT request-scoped _WEU
      expect(await jar.getCookieString("https://cer.ysu.edu.cn/authserver/login")).toBe(
        "CASTGC=TGT-abc"
      )
      expect(await jar.getCookieString("https://jwxt.ysu.edu.cn/jwapp/home.do")).toBe(
        "GS_SESSIONID=JWXT-999"
      )

      // All 3 hops recorded in http.activity burst session
      expect(http.activity.getSnapshot().session).toMatchObject({ count: 3, failed: 0 })
    } finally {
      runtime.dispose()
    }
  })

  it("preserves POST method and body across 307 redirects and enforces maxRedirects = 10", async () => {
    let callCount = 0
    const fakeHttp: PluginHttpService = {
      activity: new HttpActivityRecorder(),
      send: vi.fn(async (req: HttpRequest): Promise<HttpResponse> => {
        callCount += 1
        if (callCount === 1) {
          return {
            status: 307,
            headers: { Location: "https://example.com/step2" },
            url: req.url,
            text: async () => "",
            arrayBuffer: async () => new ArrayBuffer(0),
          }
        }
        return {
          status: 200,
          headers: {},
          url: req.url,
          text: async () => `${req.method}:${String(req.body ?? "")}`,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }),
    }

    const resp = await fetchWithCookieJar(fakeHttp, new SimpleCookieJar(), {
      method: "POST",
      url: "https://example.com/step1",
      body: "payload=1",
      redirect: "follow",
    })
    expect(await resp.text()).toBe("POST:payload=1")

    // Infinite redirect loop throws after 10 redirects (11 total sends)
    const loopHttp: PluginHttpService = {
      activity: new HttpActivityRecorder(),
      send: vi.fn(
        async (req: HttpRequest): Promise<HttpResponse> => ({
          status: 302,
          headers: { location: req.url },
          url: req.url,
          text: async () => "",
          arrayBuffer: async () => new ArrayBuffer(0),
        })
      ),
    }
    await expect(
      fetchWithCookieJar(loopHttp, new SimpleCookieJar(), {
        method: "GET",
        url: "https://example.com/loop",
        redirect: "follow",
      })
    ).rejects.toThrow("Exceeded max redirects (10)")
    expect(loopHttp.send).toHaveBeenCalledTimes(11)
  })

  it("normalizes CapacitorHttp headers to lowercase, decodes base64 arrayBuffer, and handles AbortSignal", async () => {
    capacitorMocks.isNative = true
    capacitorMocks.request.mockResolvedValueOnce({
      status: 200,
      headers: {
        "Set-Cookie": "A=1; Path=/, B=2; Expires=Wed, 21 Oct 2099 07:28:00 GMT; Path=/",
        "Content-Type": "image/jpeg",
      },
      url: "https://cdn.example.com/pic.jpg",
      data: "/9j/",
    })

    const runtime = new PluginRuntime()
    let http!: PluginHttpService
    const consumer = definePlugin({
      manifest: {
        id: "plugin.native-http",
        name: "Native HTTP Consumer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        http = ctx.http
      },
    })

    try {
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(consumer, "builtin")
      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(consumer.manifest.id)

      const jar = new SimpleCookieJar()
      const resp = await fetchWithCookieJar(http, jar, {
        method: "GET",
        url: "https://cdn.example.com/pic.jpg",
        redirect: "manual",
        responseType: "arraybuffer",
      })

      expect(capacitorMocks.request).toHaveBeenCalledWith(
        expect.objectContaining({
          disableRedirects: true,
          responseType: "arraybuffer",
        })
      )
      expect(resp.headers["content-type"]).toBe("image/jpeg")
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]))
      expect(await jar.getCookieString("https://cdn.example.com/")).toBe("A=1; B=2")

      // Aborted signal throws AbortError and records "aborted" activity outcome
      const abortController = new AbortController()
      abortController.abort()
      await expect(
        http.send({
          method: "GET",
          url: "https://cdn.example.com/aborted",
          redirect: "manual",
          signal: abortController.signal,
        })
      ).rejects.toMatchObject({ name: "AbortError" })

      const history = http.activity.getSnapshot().history
      expect(history[history.length - 1]?.outcome).toBe("aborted")
    } finally {
      runtime.dispose()
    }
  })

  it("scopes HttpActivityRecorder labelers, classifiers, and subscribers to consumer plugin lifecycle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200, headers: { "x-proxy-status": "200" } }))
    )

    const runtime = new PluginRuntime()
    const listener = vi.fn()
    let observerHttp!: PluginHttpService

    const contributor = definePlugin({
      manifest: {
        id: "plugin.classifier",
        name: "Classifier",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        ctx.http.activity.registerClassifier((url) =>
          url.includes("/grades") ? "academic" : undefined
        )
        ctx.http.activity.registerLabeler((url) =>
          url.includes("/grades") ? "activity.grades" : undefined
        )
        ctx.http.activity.state.subscribe(listener)
      },
    })

    const observer = definePlugin({
      manifest: {
        id: "plugin.observer",
        name: "Observer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        observerHttp = ctx.http
      },
    })

    try {
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(contributor, "builtin")
      runtime.register(observer, "builtin")

      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(contributor.manifest.id)
      await runtime.startAndWait(observer.manifest.id)

      await observerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/grades?token=topsecret",
        redirect: "manual",
      })

      const snap1 = observerHttp.activity.getSnapshot()
      expect(snap1.history[0]).toMatchObject({
        category: "academic",
        label: "activity.grades",
        outcome: "ok",
      })
      expect(JSON.stringify(snap1)).not.toContain("topsecret")
      expect(listener).toHaveBeenCalledTimes(2)

      // Stopping contributor automatically revokes its classifier, labeler, and state subscription
      runtime.stop(contributor.manifest.id)
      listener.mockClear()

      await observerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/grades?token=topsecret",
        redirect: "manual",
      })

      const snap2 = observerHttp.activity.getSnapshot()
      expect(snap2.history[1]).toMatchObject({ category: "other", outcome: "ok" })
      expect(snap2.history[1]?.label).toBeUndefined()
      expect(listener).not.toHaveBeenCalled()
    } finally {
      runtime.dispose()
    }
  })

  it("tracks burst session idle window, isolates broken hooks, and follows stateless http.send redirects", async () => {
    let clock = 100
    vi.spyOn(performance, "now").mockImplementation(() => clock)

    const recorder = new HttpActivityRecorder()
    recorder.registerClassifier(() => {
      throw new Error("broken classifier")
    })
    recorder.registerClassifier((url) => (url.includes("/auth") ? "auth" : undefined))
    recorder.registerLabeler(() => {
      throw new Error("broken labeler")
    })
    recorder.subscribe(() => {
      throw new Error("broken subscriber")
    })

    const finish1 = recorder.beginRequest("https://cer.ysu.edu.cn/auth", "POST")
    clock = 250
    finish1("ok")
    finish1("error") // idempotent second call ignored
    expect(recorder.getSnapshot().session).toMatchObject({
      count: 1,
      failed: 0,
      slowestCategory: "auth",
      slowestMs: 150,
    })

    // Within 2000ms idle window -> stays in same session
    clock = 2_200
    const finish2 = recorder.beginRequest("https://example.com/data", "GET")
    clock = 2_300
    finish2("error")
    expect(recorder.getSnapshot().session).toMatchObject({
      count: 2,
      failed: 1,
      totalMs: 2_200,
    })

    // Beyond 2000ms idle window -> starts fresh burst session
    clock = 4_301
    const finish3 = recorder.beginRequest("https://example.com/fresh", "GET")
    clock = 4_321
    finish3("ok")
    expect(recorder.getSnapshot().session).toMatchObject({
      count: 1,
      failed: 0,
      totalMs: 20,
    })
    expect(recorder.getSnapshot().history).toHaveLength(1)
    recorder.dispose()

    // Stateless http.send with redirect: "follow"
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "x-proxy-status": "302",
            location: "https://jwxt.ysu.edu.cn/final",
            "x-proxy-set-cookie": encodeProxySetCookie(["TEMP=1; Path=/"]),
          },
        })
      )
      .mockResolvedValueOnce(
        new Response("done", {
          status: 200,
          headers: { "x-proxy-status": "200" },
        })
      )
    vi.stubGlobal("fetch", fetchMock)

    const runtime = new PluginRuntime()
    let http!: PluginHttpService
    const client = definePlugin({
      manifest: {
        id: "plugin.stateless-follow",
        name: "Stateless Follow",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        http = ctx.http
      },
    })

    try {
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(client, "builtin")
      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(client.manifest.id)

      const res = await http.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/start",
        redirect: "follow",
      })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe("done")
      const secondHeaders = new Headers(fetchMock.mock.calls[1]![1]?.headers)
      expect(secondHeaders.get("x-proxy-cookie")).toBe("TEMP=1")
    } finally {
      runtime.dispose()
    }
  })
})
