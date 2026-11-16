import { describe, expect, it, vi } from "vitest"
import type { CookieJar, HttpResponse } from "@orahako/plugin-sdk"
import { createTestContext, type JarFetch } from "../test-context"
import type { CASProtocol } from "./cas"
import { createSCXT } from "./scxt"

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

describe("SCXT authorization recovery", () => {
  it("reauthorizes once when the first platform bridge does not issue a ticket", async () => {
    const fetchWithJar = vi.fn<JarFetch>()
    const { ctx } = createTestContext({ fetchWithJar })
    const authorize = vi.fn(async (_service: string, target?: CookieJar) =>
      target ?? ctx.session.createCookieJar()
    )
    // createSCXT only consumes these two CAS operations in this protocol test.
    const cas = {
      authorize,
      getCredentialApplied: async () => {},
    } as unknown as CASProtocol
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
})
