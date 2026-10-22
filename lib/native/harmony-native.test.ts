import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { describe, expect, it, vi } from "vitest"
import policy from "../../harmony/security-policy.json"

type Attribute = boolean | number | Uint8Array
type Attributes = Map<number, Attribute>
interface NativeStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
interface NativePolicy {
  validate(method: string, input: string, body?: string): void
}

/** Execute the actual ArkTS security classes, substituting only OS APIs. */
function loadNative(name: string, mocks: Record<string, object>): Record<string, unknown> {
  const source = readFileSync(
    new URL(`../../harmony/entry/src/main/ets/security/${name}.ets`, import.meta.url),
    "utf8"
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: Record<string, unknown> = {}
  runInNewContext(compiled, {
    exports,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    require: (id: string) => {
      if (!(id in mocks)) throw new Error(`Unexpected native dependency: ${id}`)
      return mocks[id]
    },
  })
  return exports
}

const util = {
  Base64Helper: class {
    encodeToStringSync(bytes: Uint8Array) {
      // The actual Harmony API rejects empty input; Buffer's encoder does not.
      if (bytes.length === 0) throw Object.assign(new Error("Empty Base64 input"), { code: 401 })
      return Buffer.from(bytes).toString("base64")
    }
  },
  TextEncoder: class {
    encodeInto(input: string) {
      return new TextEncoder().encode(input)
    }
  },
  TextDecoder: {
    create: () => ({ decodeToString: (bytes: Uint8Array) => new TextDecoder().decode(bytes) }),
  },
  generateRandomUUID: randomUUID,
}

class NativeURL extends URL {
  get params() {
    return this.searchParams
  }
}
const nativeUrl = { URL: NativeURL, URLParams: URLSearchParams }

describe("native immersive window appearance", () => {
  function appearance() {
    return loadNative("../WindowAppearance", {
      "@kit.ArkUI": {
        window: {
          AvoidAreaType: { TYPE_SYSTEM: 0, TYPE_CUTOUT: 1, TYPE_NAVIGATION_INDICATOR: 4 },
        },
      },
    }) as {
      readWindowSafeArea(window: object): { top: number; right: number; bottom: number; left: number }
      applyWindowTheme(window: object, dark: boolean): Promise<void>
    }
  }

  it("merges overlapping system areas without counting the keyboard and rereads after rotation", () => {
    const area = (top = 0, right = 0, bottom = 0, left = 0) => ({
      topRect: { height: top },
      rightRect: { width: right },
      bottomRect: { height: bottom },
      leftRect: { width: left },
    })
    const areas = new Map([
      [0, area(100, 0, 70)],
      [1, area(120, 0, 0, 50)],
      [4, area(0, 0, 90)],
    ])
    const mainWindow = {
      getWindowAvoidArea(type: number) {
        const result = areas.get(type)
        if (!result) throw new Error("Unexpected area (including keyboard)")
        return result
      },
    }
    const { readWindowSafeArea } = appearance()
    expect(readWindowSafeArea(mainWindow)).toEqual({ top: 120, right: 0, bottom: 90, left: 50 })
    areas.set(0, area(0, 0, 0, 100))
    areas.set(1, area(0, 0, 0, 120))
    areas.set(4, area(0, 90))
    expect(readWindowSafeArea(mainWindow)).toEqual({ top: 0, right: 90, bottom: 0, left: 120 })
  })

  it("keeps system backgrounds transparent in both themes and changes icon contrast", async () => {
    const setWindowSystemBarProperties = vi.fn(async () => {})
    const { applyWindowTheme } = appearance()
    await applyWindowTheme({ setWindowSystemBarProperties }, false)
    await applyWindowTheme({ setWindowSystemBarProperties }, true)
    for (const [index, foreground] of ["#000000", "#ffffff"].entries()) {
      expect(setWindowSystemBarProperties.mock.calls[index]).toEqual([
        expect.objectContaining({
          statusBarColor: "#00000000",
          navigationBarColor: "#00000000",
          statusBarContentColor: foreground,
          navigationBarContentColor: foreground,
        }),
      ])
    }
  })
})

describe("actual ArkTS bundled resource policy", () => {
  const resolvePath = loadNative("ResourcePolicy", {}).localResourcePath as (
    input: string,
    origin: string
  ) => string
  const origin = "https://ysu.local"

  it.each(["0ev0vbebrwic..js", "0rhdvkc8cgmk..js", "0.bdlgergfh74.js"])(
    "serves valid Turbopack filenames containing dots: %s",
    (filename) => {
      expect(resolvePath(`${origin}/_next/static/chunks/${filename}`, origin)).toBe(
        `www/_next/static/chunks/${filename}`
      )
    }
  )

  it("resolves packaged page routes and strips query strings", () => {
    expect(resolvePath(`${origin}/login/?source=app#top`, origin)).toBe("www/login/index.html")
    expect(resolvePath(`${origin}/`, origin)).toBe("www/index.html")
  })

  it.each([
    "https://evil.example/login/",
    "https://ysu.local.evil.example/login/",
    `${origin}/../security-policy.json`,
    `${origin}/_next/../../security-policy.json`,
    `${origin}/./index.html`,
    `${origin}/%2e%2e/security-policy.json`,
    `${origin}/_next%2fsecret.js`,
    `${origin}/_next\\secret.js`,
    `${origin}//index.html`,
  ])("rejects external resources and directory traversal: %s", (input) => {
    expect(() => resolvePath(input, origin)).toThrow()
  })
})

function storeFixture() {
  const records = new Map<string, Attributes>()
  const tag = {
    ALIAS: 1,
    SECRET: 2,
    RETURN_TYPE: 3,
    ACCESSIBILITY: 4,
    SYNC_TYPE: 5,
    IS_PERSISTENT: 6,
    CONFLICT_RESOLUTION: 7,
  }
  const alias = (data: Attributes) => new TextDecoder().decode(data.get(tag.ALIAS) as Uint8Array)
  let failManifest = false
  const asset = {
    Tag: tag,
    ReturnType: { ALL: 0 },
    ErrorCode: { NOT_FOUND: 24000002 },
    Accessibility: { DEVICE_UNLOCKED: 2 },
    SyncType: { NEVER: 0 },
    ConflictResolution: { OVERWRITE: 0 },
    async add(data: Attributes) {
      const key = alias(data)
      if (data.has(tag.IS_PERSISTENT)) throw new Error("Unnecessary persistent-data permission")
      const secret = data.get(tag.SECRET) as Uint8Array
      if (secret.length < 1 || secret.length > 1024) throw new Error("Invalid asset size")
      if (failManifest && key.endsWith(".manifest")) throw new Error("Device locked")
      records.set(key, new Map(data))
    },
    async query(data: Attributes) {
      const record = records.get(alias(data))
      if (!record) throw { code: 24000002 }
      return [new Map(record)]
    },
    async remove(data: Attributes) {
      records.delete(alias(data))
    },
  }
  const Store = loadNative("SecureStore", {
    "@kit.AssetStoreKit": { asset },
    "@kit.ArkTS": { util },
  }).SecureStore as new () => NativeStore
  return {
    store: new Store(),
    records,
    tag,
    lockManifest: () => {
      failManifest = true
    },
  }
}

describe("native Asset Store implementation", () => {
  it("roundtrips large Unicode sessions using only device-local encrypted asset chunks", async () => {
    const { store, records, tag } = storeFixture()
    const data = JSON.stringify({ token: "测试会话".repeat(1000) })
    await store.set("academic-client-auth", data)
    expect(await store.get("academic-client-auth")).toBe(data)
    expect(records.size).toBeGreaterThan(2)
    for (const record of records.values()) {
      expect(record.get(tag.ACCESSIBILITY)).toBe(2)
      expect(record.get(tag.SYNC_TYPE)).toBe(0)
      expect(record.has(tag.IS_PERSISTENT)).toBe(false)
    }
    await store.set("academic-client-auth", "")
    expect(await store.get("academic-client-auth")).toBe("")
  })

  it("retains the previous encrypted version if a replacement cannot commit", async () => {
    const { store, lockManifest } = storeFixture()
    await store.set("academic-client-auth", "old-session")
    lockManifest()
    await expect(store.set("academic-client-auth", "new-session".repeat(300))).rejects.toThrow()
    expect(await store.get("academic-client-auth")).toBe("old-session")
  })

  it("serializes reads, writes and logout removal without torn or revived snapshots", async () => {
    const { store, records } = storeFixture()
    const writing = store.set("academic-client-auth", "new-session".repeat(300))
    const reading = store.get("academic-client-auth")
    const removing = store.remove("academic-client-auth")
    await writing
    expect(await reading).toBe("new-session".repeat(300))
    await removing
    expect(await store.get("academic-client-auth")).toBeNull()
    expect(records.size).toBe(0)
  })
})

describe("actual ArkTS request policy", () => {
  it("enforces the packaged policy independently of the page-side checks", () => {
    const Policy = loadNative("RequestPolicy", {
      "@kit.ArkTS": { util, url: nativeUrl },
    }).RequestPolicy as new (manager: object) => NativePolicy
    const native = new Policy({
      getRawFileContentSync: () => new TextEncoder().encode(JSON.stringify(policy)),
    })
    expect(() =>
      native.validate("POST", "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).not.toThrow()
    const mfaPage = "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do"
    const callback = encodeURIComponent(
      "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html"
    )
    expect(() => native.validate("GET", `${mfaPage}?service=${callback}`)).not.toThrow()
    expect(() => native.validate("POST", mfaPage)).toThrow()
    expect(() => native.validate("GET", `${mfaPage}?service=https://evil.example`)).toThrow()
    for (const url of [
      "https://ysu.welain.com/api/proxy",
      "https://jwxt.ysu.edu.cn/jwmobile/biz/v410/signin/delete",
      "http://jwxt.ysu.edu.cn/authserver/login",
      "https://jwxt.ysu.edu.cn/jwapp/sys/bkbl/modules/bkbm/xgksrwxs.do",
    ]) {
      expect(() => native.validate("POST", url)).toThrow()
    }
    for (const route of policy.routes.filter((item) => item.path.startsWith("/jwmobile/"))) {
      expect(() => native.validate(route.method, `${route.origin}${route.path}`)).not.toThrow()
      expect(() => native.validate(route.method === "GET" ? "POST" : "GET", `${route.origin}${route.path}`)).toThrow()
    }
    expect(() =>
      native.validate("GET", "https://cer.ysu.edu.cn/authserver/login?service=https://evil.example")
    ).toThrow()
  })
})

describe("actual ArkTS network bridge", () => {
  it.each([302, 204])(
    "preserves an empty HTTP %i response without passing it to Base64",
    (status) => {
      const Bridge = loadNative("../bridge/NativeBridge", {
        "@kit.ArkTS": { util },
        "../security/RequestPolicy": { RequestPolicy: class {} },
        "../security/SecureStore": { SecureStore: class {} },
        "@kit.RemoteCommunicationKit": { rcp: {} },
      }).NativeBridge as new (controller: object) => {
        encodeResponse(response: object): { status: number; headers: object; bodyBase64: string }
      }
      const bridge = new Bridge({})
      for (const body of [undefined, new ArrayBuffer(0)]) {
        expect(
          bridge.encodeResponse({ statusCode: status, headers: { location: "/next" }, body })
        ).toEqual({
          status,
          headers: { location: "/next" },
          bodyBase64: "",
        })
      }
    }
  )

  it("reports network and storage failures separately without exposing native error details", async () => {
    const sensitive = "https://example.invalid/?password=must-never-appear"
    const replies: Array<{ ok: boolean; error: string }> = []
    const Bridge = loadNative("../bridge/NativeBridge", {
      "@kit.ArkTS": { util },
      "../security/RequestPolicy": {
        RequestPolicy: class {
          validate() {}
        },
      },
      "../security/SecureStore": {
        SecureStore: class {
          async get() {
            throw new Error(sensitive)
          }
        },
      },
      "@kit.RemoteCommunicationKit": {
        rcp: {
          Request: class {},
          createSession: () => ({
            async fetch() {
              throw Object.assign(new Error(sensitive), { code: 1007900006 })
            },
            close() {},
          }),
        },
      },
    }).NativeBridge as new (controller: object) => {
      initialize(manager: object): void
      postMessage(raw: string): void
    }
    const bridge = new Bridge({
      getUrl: () => "https://ysu.local/login/",
      runJavaScript: async (script: string) => {
        replies.push(JSON.parse(script.slice(script.indexOf("(") + 1, -1)))
      },
    })
    bridge.initialize({})
    bridge.postMessage(
      JSON.stringify({
        id: "h101",
        method: "http.request",
        params: { method: "GET", url: "https://cer.ysu.edu.cn/authserver/login" },
      })
    )
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(replies[0]).toMatchObject({ ok: false })
    expect(replies[0].error).toContain("学校连接失败")
    expect(replies[0].error).toContain("1007900006")
    bridge.postMessage(
      JSON.stringify({
        id: "h102",
        method: "secure.get",
        params: { key: "academic-client-auth" },
      })
    )
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    expect(replies[1].error).toContain("安全存储读取失败")
    expect(JSON.stringify(replies)).not.toContain("must-never-appear")
    expect(JSON.stringify(replies)).not.toContain("example.invalid")
  })

  it("blocks foreign pages and unreviewed calls, and forces direct single-hop native requests", async () => {
    interface SessionOptions {
      requestConfiguration: { proxy: string; transfer: { autoRedirect: boolean } }
    }
    interface CapturedRequest {
      url: string
      method: string
      headers: Record<string, string>
      body?: string
    }
    const sent: CapturedRequest[] = []
    const replies: string[] = []
    const options: SessionOptions[] = []
    const closed = vi.fn()
    const Policy = loadNative("RequestPolicy", {
      "@kit.ArkTS": { util, url: nativeUrl },
    }).RequestPolicy
    const Bridge = loadNative("../bridge/NativeBridge", {
      "@kit.ArkTS": { util },
      "../security/RequestPolicy": { RequestPolicy: Policy },
      "../security/SecureStore": { SecureStore: class {} },
      "@kit.RemoteCommunicationKit": {
        rcp: {
          Request: class {
            constructor(
              public url: string,
              public method: string,
              public headers: Record<string, string>,
              public body?: string
            ) {}
          },
          createSession(configuration: SessionOptions) {
            options.push(configuration)
            return {
              async fetch(request: CapturedRequest) {
                sent.push(request)
                return {
                  statusCode: 302,
                  headers: { location: "/authserver/index.do" },
                  body: new ArrayBuffer(0),
                }
              },
              close: closed,
            }
          },
        },
      },
    }).NativeBridge as new (controller: object) => {
      initialize(manager: object): void
      postMessage(raw: string): void
    }
    let origin = "https://evil.example/"
    const bridge = new Bridge({
      getUrl: () => origin,
      runJavaScript: async (source: string) => {
        replies.push(source)
      },
    })
    bridge.initialize({
      getRawFileContentSync: () => new TextEncoder().encode(JSON.stringify(policy)),
    })
    const message = (id: string, url: string) =>
      JSON.stringify({ id, method: "http.request", params: { method: "GET", url } })
    bridge.postMessage(message("h1", "https://cer.ysu.edu.cn/authserver/login"))
    expect(sent).toHaveLength(0)
    expect(replies).toHaveLength(0)
    origin = "https://ysu.local/login/"
    bridge.postMessage(message("h2", "https://ysu.welain.com/api/proxy?secret=never-echo-this"))
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(sent).toHaveLength(0)
    expect(replies[0]).not.toContain("never-echo-this")
    bridge.postMessage(message("h3", "https://cer.ysu.edu.cn/authserver/login"))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(options[0].requestConfiguration.proxy).toBe("no-proxy")
    expect(options[0].requestConfiguration.transfer.autoRedirect).toBe(false)
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    expect(replies[1]).toContain('"ok":true')
    expect(replies[1]).toContain('"status":302')
    expect(replies[1]).toContain('"bodyBase64":""')
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
  })
})
