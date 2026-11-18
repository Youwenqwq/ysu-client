import { describe, expect, it, vi } from "vitest"
import type { CookieJar } from "@orahako/academic-sdk"
import type { HttpResponse } from "@orahako/sdk"
import type { CasAuthorizer } from "../src/protocol/cas"
import { createLDXT } from "../src/protocol/ldxt"
import { createSCXT } from "../src/protocol/scxt"
import { createXGXT } from "../src/protocol/xgxt"
import { createTestContext, type JarFetch } from "./test-helper"

const PT_BASE = "http://202.206.247.49/ysu_pt"
const SCXT_BASE = "http://202.206.247.49/ysu_xf"
const HOME_URL = `${SCXT_BASE}/System/Home/Index`
const TICKET_URL = `${SCXT_BASE}/authserver/access?ticket=test-ticket`

function response(
  url: string,
  status = 200,
  body = "",
  headers: Record<string, string> = {}
): HttpResponse {
  return {
    status,
    url,
    headers,
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const SUMMARY_HTML = `
  <table>
    <thead><tr><th>账号</th><th>用户名</th><th>成绩</th><th>总学分</th></tr></thead>
    <tbody><tr><td>20260001</td><td>测试学生</td><td>C</td><td>7</td></tr></tbody>
  </table>
`

describe("SCXT, LDXT & XGXT protocol parsing and authorization recovery", () => {
  it("reauthorizes SCXT once when the first platform bridge does not issue a ticket", async () => {
    const fetchWithJar = vi.fn<JarFetch>()
    const { ctx } = createTestContext({ fetchWithJar })
    const authorize = vi.fn(async (_service: string, target?: CookieJar) => {
      return target ?? ctx.session.createCookieJar()
    })
    const cas: CasAuthorizer = {
      authorize,
      getCredentialApplied: async () => {},
    }
    const scxt = createSCXT(ctx, cas)

    fetchWithJar
      .mockResolvedValueOnce(
        response(`${PT_BASE}/System/Platform/AccessSubsystem/first`, 302, "", {
          location: `${PT_BASE}/System/User/Login`,
        })
      )
      .mockResolvedValueOnce(response(TICKET_URL, 302, "", { location: TICKET_URL }))
      .mockResolvedValueOnce(response(TICKET_URL, 302, "", { location: HOME_URL }))
      .mockResolvedValueOnce(response(HOME_URL))
      .mockResolvedValueOnce(response(HOME_URL))
      .mockResolvedValueOnce(response(`${SCXT_BASE}/XueFen/SummaryQuery/Index`, 200, SUMMARY_HTML))

    await expect(scxt.queryCreditSummary()).resolves.toMatchObject({
      studentId: "20260001",
      grade: "C",
      totalCredits: 7,
    })
    expect(authorize).toHaveBeenCalledTimes(2)
    expect(fetchWithJar).toHaveBeenCalledTimes(6)
  })

  it("authenticates LDXT via 3-step SSO handshake and parses labor records with badges", async () => {
    const fetchWithJar = vi.fn<JarFetch>()
    const { ctx } = createTestContext({ fetchWithJar })
    const cas: CasAuthorizer = {
      authorize: async (_service, target) => target ?? ctx.session.createCookieJar(),
      getCredentialApplied: async () => {},
    }
    const ldxt = createLDXT(ctx, cas)

    const recordsHtml = `
      <table>
        <thead><tr><th>学期</th><th>活动名称</th><th>活动大类</th><th>活动时间</th><th>劳动时长</th><th>状态</th></tr></thead>
        <tbody><tr>
          <td>2025-2026-1</td>
          <td>校园绿化 <span class="m-badge">自主报名</span></td>
          <td>公益劳动</td>
          <td>2025-10-01 08:00 至 2025-10-01 10:00</td>
          <td>2</td>
          <td>已认定</td>
        </tr></tbody>
      </table>
    `

    fetchWithJar
      .mockResolvedValueOnce(
        response(
          "https://ldxt.ysu.edu.cn/About/UnifiedAuthenticationLogin",
          200,
          JSON.stringify({ Success: true, Data: { Url: "/System/User/LoginRole" } })
        )
      )
      .mockResolvedValueOnce(response("https://ldxt.ysu.edu.cn/System/User/LoginRole", 200, "ok"))
      .mockResolvedValueOnce(response("https://ldxt.ysu.edu.cn/XueFen/Summary", 200, recordsHtml))

    const records = await ldxt.queryLaborRecords()
    expect(records).toEqual([
      expect.objectContaining({
        term: "2025-2026-1",
        name: "校园绿化",
        enrollType: "自主报名",
        category: "公益劳动",
        timeStart: "2025-10-01T08:00:00",
        timeEnd: "2025-10-01T10:00:00",
        hours: 2,
        status: "已认定",
      }),
    ])
  })

  it("binds XGXT app role and parses comprehensive evaluation results", async () => {
    const fetchWithJar = vi.fn<JarFetch>()
    const { ctx } = createTestContext({ fetchWithJar })
    const cas: CasAuthorizer = {
      authorize: async (_service, target) => target ?? ctx.session.createCookieJar(),
      getCredentialApplied: async () => {},
    }
    const xgxt = createXGXT(ctx, cas)

    fetchWithJar
      // 1. getAppConfig
      .mockResolvedValueOnce(
        response(
          "https://xgxt.ysu.edu.cn/xsfw/sys/swpubapp/indexmenu/getAppConfig.do",
          200,
          JSON.stringify({ HEADER: { dropMenu: [{ id: "student-role", active: true }] } })
        )
      )
      // 2. setXgCommonAppRole
      .mockResolvedValueOnce(
        response(
          "https://xgxt.ysu.edu.cn/xsfw/sys/swpubapp/userinfo/setXgCommonAppRole.do",
          200,
          JSON.stringify({ returnCode: "#E000000000000" })
        )
      )
      // 3. changeAppRole
      .mockResolvedValueOnce(
        response(
          "https://xgxt.ysu.edu.cn/xsfw/sys/funauthapp/api/changeAppRole/zhcptybbapp/student-role.do",
          200,
          JSON.stringify({ success: true })
        )
      )
      // 4. getEvaluationResultsByXn
      .mockResolvedValueOnce(
        response(
          "https://xgxt.ysu.edu.cn/xsfw/sys/zhcptybbapp/modules/evaluationApplyController/getEvaluationResultsByXn.do",
          200,
          JSON.stringify({
            code: "0",
            data: {
              ZCJ: "88.5",
              BJPM: 3,
              BJRS: 30,
              ZYNJPM: 12,
              ZYNJRS: 180,
              CPXN: "2025",
              CPXQ: "1",
              CPXN_DISPLAY: "2025-2026学年",
              CPXQ_DISPLAY: "第一学期",
              ZBLIST: [{ ZBMC: "学业表现", FS: "70", RK: 2, ZDZ: "75" }],
            },
          })
        )
      )

    const result = await xgxt.queryEvaluationResult("2025", "1")
    expect(result).toMatchObject({
      totalScore: "88.5",
      classRank: 3,
      classSize: 30,
      gradeRank: 12,
      gradeSize: 180,
      year: "2025",
      term: "1",
      indicators: [expect.objectContaining({ name: "学业表现", score: "70", rank: 2 })],
    })
  })
})
