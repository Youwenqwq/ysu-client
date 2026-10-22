import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { YSUMobileAdapter } from "../adapters/mobile-adapter"
import { ProviderErrorCode } from "../../errors"
import { resetCAS } from "./cas"
import { MobileSession, ensureMobileAuthorized, resetMobileAuth, restoreSession } from "./jwmobile"

const mocks = vi.hoisted(() => ({ setMobileSession: vi.fn() }))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: () => ({ setMobileSession: mocks.setMobileSession }) },
}))
vi.mock("@/lib/storage/secure", () => ({
  saveCASTGC: vi.fn().mockResolvedValue(undefined),
  loadCASTGC: vi.fn().mockResolvedValue(null),
}))

const official = "https://jwxt.ysu.edu.cn"
const auth = `${official}/jwmobile/auth/index`
const api = `${official}/jwmobile/biz/v410`
const query = {
  teachClassId: "test-class",
  teachClassType: "1",
  scheduleId: "test-schedule",
  week: 8,
  weekDay: 3,
  startNode: 1,
  endNode: 2,
}
interface Request {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}
interface Reply {
  status: number
  headers?: Record<string, string | string[]>
  data?: object
}

function fixture(override?: (request: Request) => Reply | undefined) {
  const requests: Request[] = []
  const fetch = vi.fn(() => {
    throw new Error("Browser/proxy transport must not be used")
  })
  vi.stubGlobal("fetch", fetch)
  vi.stubGlobal("window", {
    YSUHarmony: {
      postMessage(raw: string) {
        const message = JSON.parse(raw) as { id: string; method: string; params: Request }
        expect(message.method).toBe("http.request")
        const request = message.params
        requests.push(request)
        let reply = override?.(request)
        if (!reply && request.url.startsWith("https://cer.ysu.edu.cn/authserver/login?")) {
          expect(new URL(request.url).searchParams.get("service")).toBe(auth)
          reply = { status: 302, headers: { location: `${auth}?ticket=test-ticket` } }
        }
        if (!reply && request.url.startsWith(auth)) {
          reply = {
            status: 302,
            headers: {
              location: "/jwmobile/index.html?token=test.mobile.jwt",
              "set-cookie": "JSESSIONID=mobile-session; Path=/jwmobile; Secure",
            },
          }
        }
        if (!reply && request.url === `${api}/lesson/queryCurrentLesson`) {
          reply = {
            status: 200,
            data: {
              code: 200,
              data: {
                lessonId: "lesson",
                activityList: [
                  { activityId: "signin", signClazz: "1", signType: "2", isEnd: false },
                  { activityId: "signout", signClazz: "2", signType: "1", isEnd: false },
                ],
              },
            },
          }
        }
        if (!reply && request.url === `${api}/signin/detail`) {
          reply = {
            status: 200,
            data: {
              code: 200,
              data: {
                activityId: "signin",
                leftSeconds: 90,
                signinType: 2,
              },
            },
          }
        }
        if (!reply && request.url === `${api}/signin/querySigninDetail`) {
          reply = {
            status: 200,
            data: {
              code: 200,
              data: {
                signStatus: 0,
                signOrder: 0,
                signinType: 2,
              },
            },
          }
        }
        if (!reply && request.url === `${api}/signin/sign`) {
          reply = {
            status: 200,
            data: {
              code: 200,
              data: {
                signStatus: 1,
                signOrder: 2,
                attendanceStatus: 1,
              },
            },
          }
        }
        if (!reply) throw new Error(`Unexpected test request: ${request.url}`)
        const response = reply
        queueMicrotask(() =>
          window.__ysuHarmonyReply!({
            id: message.id,
            ok: true,
            data: {
              status: response.status,
              headers: response.headers ?? {},
              bodyBase64: response.data ? btoa(JSON.stringify(response.data)) : "",
            },
          })
        )
      },
    },
  })
  return { mobile: new YSUMobileAdapter(), requests, fetch }
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_PLATFORM", "harmony")
  vi.clearAllMocks()
  resetCAS()
  resetMobileAuth()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("Harmony mobile sign-in via the real CAS, cookie and native transport layers", () => {
  it("loads activities and personal status without submitting or fetching the token landing page", async () => {
    const { mobile, requests, fetch } = fixture()
    const lesson = await mobile.getCurrentLesson(query)
    expect(lesson.activityList.map((item) => item.signClazz)).toEqual(["1", "2"])
    const [detail, status] = await Promise.all([
      mobile.getSigninDetail({ activityId: "signin" }),
      mobile.getStudentSigninStatus({ activityId: "signin" }),
    ])
    expect(detail.leftSeconds).toBe(90)
    expect(status.signStatus).toBe(0)
    expect(requests).toHaveLength(5)
    expect(requests.filter((request) => request.url === `${api}/signin/sign`)).toEqual([])
    expect(requests.some((request) => request.url.includes("token="))).toBe(false)
    for (const request of requests.filter((item) => item.method === "POST")) {
      expect(request.headers.cookie).toContain("Authorization=test.mobile.jwt")
      expect(request.headers.cookie).toContain("JSESSIONID=mobile-session")
    }
    expect(JSON.parse(requests[2].body!)).toEqual(query)
    expect(mocks.setMobileSession).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([undefined, "1234", "test-qr-code"])(
    "submits the user's selected activity and code %s",
    async (code) => {
      const { mobile, requests } = fixture()
      expect(await mobile.doStudentSign({ activityId: "signout", code })).toMatchObject({
        signStatus: 1,
        signOrder: 2,
        attendanceStatus: 1,
      })
      const submitted = requests.filter((request) => request.url === `${api}/signin/sign`)
      expect(submitted).toHaveLength(1)
      expect(JSON.parse(submitted[0].body!)).toEqual({
        activityId: "signout",
        accuracy: 0,
        latitude: 0,
        longitude: 0,
        ...(code ? { code } : {}),
      })
    }
  )

  it("reauthorizes a restored expired mobile token once and retries the query", async () => {
    await restoreSession(
      new MobileSession([
        {
          name: "Authorization",
          value: "expired",
          domain: "jwxt.ysu.edu.cn",
          path: "/jwmobile",
          secure: true,
          expires: null,
        },
      ])
    )
    const { mobile, requests } = fixture((request) =>
      request.url === `${api}/lesson/queryCurrentLesson` &&
      request.headers.cookie.includes("Authorization=expired")
        ? { status: 200, data: { code: 401 } }
        : undefined
    )
    expect((await mobile.getCurrentLesson(query)).lessonId).toBe("lesson")
    expect(
      requests.filter((request) => request.url === `${api}/lesson/queryCurrentLesson`)
    ).toHaveLength(2)
    expect(requests.at(-1)?.headers.cookie).toContain("Authorization=test.mobile.jwt")
  })

  it("maps required CAS login to session expiry instead of treating it as a mobile token", async () => {
    const { mobile, requests } = fixture((request) =>
      request.url.startsWith("https://cer.ysu.edu.cn/") ? { status: 200 } : undefined
    )
    await expect(mobile.getCurrentLesson(query)).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
    expect(requests).toHaveLength(1)
  })

  it("verifies and reuses a restored mobile session during startup warmup", async () => {
    await restoreSession(
      new MobileSession([
        {
          name: "Authorization",
          value: "restored",
          domain: "jwxt.ysu.edu.cn",
          path: "/jwmobile",
          secure: true,
          expires: null,
        },
      ])
    )
    const { mobile, requests } = fixture((request) =>
      request.url === `${api}/` ? { status: 404 } : undefined
    )
    await ensureMobileAuthorized(true)
    await mobile.getCurrentLesson(query)
    expect(requests.map((request) => request.url)).toEqual([
      `${api}/`,
      `${api}/lesson/queryCurrentLesson`,
    ])
    expect(requests[1].headers.cookie).toContain("Authorization=restored")
  })

  it("returns the school's rejection for an incorrect sign-in code", async () => {
    const { mobile, requests } = fixture((request) =>
      request.url === `${api}/signin/sign`
        ? { status: 200, data: { code: 400, msg: "Invalid sign-in code" } }
        : undefined
    )
    await expect(
      mobile.doStudentSign({ activityId: "signin", code: "0000" })
    ).rejects.toMatchObject({
      code: ProviderErrorCode.BACKEND_BUSINESS_ERROR,
      message: "Invalid sign-in code",
    })
    expect(requests.filter((request) => request.url === `${api}/signin/sign`)).toHaveLength(1)
  })

  it("does not replay a sign-in submission after a network/server failure", async () => {
    const { mobile, requests } = fixture((request) =>
      request.url === `${api}/signin/sign` ? { status: 503 } : undefined
    )
    await expect(mobile.doStudentSign({ activityId: "signin" })).rejects.toMatchObject({
      code: ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
    })
    expect(requests.filter((request) => request.url === `${api}/signin/sign`)).toHaveLength(1)
  })

  it("rejects a token redirect to another origin without making a request there", async () => {
    const { mobile, requests } = fixture((request) =>
      request.url.startsWith(auth)
        ? {
            status: 302,
            headers: {
              location: "https://evil.example/jwmobile/?token=untrusted",
            },
          }
        : undefined
    )
    await expect(mobile.getCurrentLesson(query)).rejects.toThrow()
    expect(requests).toHaveLength(2)
    expect(mocks.setMobileSession).not.toHaveBeenCalled()
  })
})
