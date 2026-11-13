import {
  fetchWithJar,
  SimpleCookieJar,
  type HttpRequest,
  type HttpResponse,
} from "@orahako/plugin-sdk/host"
import { aes128EcbEncrypt, bytesToBase64 } from "@orahako/plugin-sdk/crypto"
import type {
  ExamQueryOptions,
  GradeQueryOptions,
  ScheduleQueryOptions,
} from "@orahako/plugin-sdk/academic"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import {
  discoverCurrentSemester,
  mapExams,
  mapGrades,
  mapSchedule,
  parseStudentInfo,
  parseTermContext,
  semesterCode,
  type ZmuTermContext,
} from "./mappers"

export const ZMU_BASE_URL = "https://jwxt.zmu.edu.cn"

type Transport = (jar: SimpleCookieJar, request: HttpRequest) => Promise<HttpResponse>

export interface ZmuLoginResult {
  code: number
  message: string
  url?: string
}

function isLoginPage(html: string): boolean {
  return /id=["']login-form["']/.test(html) && /name=["']account["']/.test(html)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      "ZMU returned invalid JSON",
      error
    )
  }
}

export class ZMUClient {
  private jar = new SimpleCookieJar()
  private currentSemesterCode: string | undefined
  private captchaDataUrl: string | null = null

  constructor(private readonly transport: Transport = fetchWithJar) {}

  get credential(): string {
    return this.jar.toJSON()
  }

  get captchaUrl(): string | null {
    return this.captchaDataUrl
  }

  async hasSession(): Promise<boolean> {
    return (await this.jar.getAllCookies()).some((cookie) => cookie.name === "JSESSIONID")
  }

  restore(credential: string): void {
    this.jar = SimpleCookieJar.fromJSON(credential)
    this.currentSemesterCode = undefined
    this.captchaDataUrl = null
  }

  reset(): void {
    this.jar = new SimpleCookieJar()
    this.currentSemesterCode = undefined
    this.captchaDataUrl = null
  }

  private async send(
    path: string,
    init: {
      method?: "GET" | "POST"
      body?: URLSearchParams
      responseType?: "arraybuffer"
      authenticated?: boolean
      proxyTargetInHeader?: boolean
    } = {}
  ): Promise<HttpResponse> {
    try {
      const response = await this.transport(this.jar, {
        method: init.method ?? "GET",
        url: `${ZMU_BASE_URL}${path}`,
        headers: {
          referer: `${ZMU_BASE_URL}/`,
          ...(init.method === "POST"
            ? {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
              }
            : {}),
        },
        body: init.body,
        redirect: "follow",
        responseType: init.responseType,
        proxyTargetInHeader: init.proxyTargetInHeader,
      })
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          init.authenticated === false
            ? ProviderErrorCode.BACKEND_PROTOCOL_ERROR
            : ProviderErrorCode.AUTH_SESSION_EXPIRED,
          `ZMU request rejected: HTTP ${response.status}`,
          undefined,
          response.status
        )
      }
      if (response.status < 200 || response.status >= 400) {
        throw new ProviderError(
          ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
          `ZMU request failed: HTTP ${response.status}`,
          undefined,
          response.status
        )
      }
      return response
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError(ProviderErrorCode.NETWORK_ERROR, "ZMU network request failed", error)
    }
  }

  private async text(path: string, authenticated = true): Promise<string> {
    const body = await (await this.send(path)).text()
    if (authenticated && isLoginPage(body)) {
      throw new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, "ZMU session expired")
    }
    return body
  }

  private async post(path: string, body: URLSearchParams): Promise<unknown> {
    const text = await (await this.send(path, { method: "POST", body })).text()
    if (isLoginPage(text)) {
      throw new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, "ZMU session expired")
    }
    return parseJson(text)
  }

  async prepareLogin(): Promise<void> {
    const html = await this.text("/", false)
    if (!isLoginPage(html)) {
      throw new ProviderError(
        ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
        "ZMU login page is unavailable"
      )
    }
    this.captchaDataUrl = null
  }

  async refreshCaptcha(): Promise<string> {
    const response = await this.send(`/yzm?d=${Date.now()}`, {
      responseType: "arraybuffer",
      authenticated: false,
    })
    const contentType = response.headers["content-type"]
    const mime = (Array.isArray(contentType) ? contentType[0] : contentType)?.split(";")[0]
    this.captchaDataUrl = `data:${mime || "image/jpeg"};base64,${bytesToBase64(
      new Uint8Array(await response.arrayBuffer())
    )}`
    return this.captchaDataUrl
  }

  async login(username: string, password: string, captcha: string): Promise<ZmuLoginResult> {
    const key = new TextEncoder().encode(captcha.repeat(4))
    const encrypted = aes128EcbEncrypt(key, new TextEncoder().encode(password))
    const pwd = [...encrypted].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    const response = await this.send("/new/login", {
      method: "POST",
      body: new URLSearchParams({ account: username, pwd, verifycode: captcha }),
      authenticated: false,
      proxyTargetInHeader: true,
    })
    const payload = parseJson(await response.text())
    if (!payload || typeof payload !== "object" || !("code" in payload)) {
      throw new ProviderError(
        ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
        "ZMU login response is invalid"
      )
    }
    const code = Number(payload.code)
    const message = "message" in payload ? String(payload.message ?? "") : ""
    const data =
      "data" in payload && payload.data && typeof payload.data === "object" ? payload.data : null
    const url = data && "url" in data ? String(data.url ?? "") : undefined
    if (!Number.isFinite(code)) {
      throw new ProviderError(
        ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
        "ZMU login response is invalid"
      )
    }
    this.captchaDataUrl = null
    return { code, message, url }
  }

  async checkAuthStatus(): Promise<boolean> {
    return !isLoginPage(await this.text("/new/welcome.page", false))
  }

  async logout(): Promise<void> {
    await this.text("/new/logout", false)
  }

  async getStudentInfo() {
    return parseStudentInfo(await this.text("/new/student/xjkpxx/edit.page?confirmInfo="))
  }

  private async resolveSemester(semester?: string): Promise<string> {
    if (semester?.trim()) return semesterCode(semester)
    if (this.currentSemesterCode) return this.currentSemesterCode
    this.currentSemesterCode = discoverCurrentSemester(
      await this.text("/xsgrkbcx!xsgrkbMain.action")
    )
    return this.currentSemesterCode
  }

  async getTermContext(semester?: string): Promise<ZmuTermContext> {
    const code = await this.resolveSemester(semester)
    const context = parseTermContext(
      await this.text(`/xsgrkbcx!getXsgrbkList.action?xnxqdm=${code}`)
    )
    this.currentSemesterCode ??= context.code
    return context
  }

  async getSchedule(options?: ScheduleQueryOptions) {
    const code = await this.resolveSemester(options?.semester)
    const week = options?.week ? String(options.week) : ""
    const payload = parseJson(
      await this.text(`/xsgrkbcx!getKbRq.action?xnxqdm=${code}&zc=${encodeURIComponent(week)}`)
    )
    return mapSchedule(payload)
  }

  async getGrades(options?: GradeQueryOptions) {
    const code = options?.semester ? semesterCode(options.semester) : ""
    const payload = await this.post(
      "/xskccjxx!getDataList.action",
      new URLSearchParams({
        page: String(options?.pageNumber ?? 1),
        rows: String(options?.pageSize ?? 1000),
        xnxqdm: code,
        primarySort: " cjdm asc ",
        sort: "xnxqdm",
        order: "asc",
        ...(options?.courseName ? { kcmc: options.courseName } : {}),
        ...(options?.courseType ? { jhlxdm: options.courseType } : {}),
      })
    )
    return mapGrades(payload)
  }

  async getExams(options?: ExamQueryOptions) {
    const code = await this.resolveSemester(options?.semester)
    const payload = await this.post(
      "/xsksap!getDataList.action",
      new URLSearchParams({ page: "1", rows: "100", xnxqdm: code })
    )
    return mapExams(payload)
  }
}
