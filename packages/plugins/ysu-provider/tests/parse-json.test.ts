import { describe, expect, it } from "vitest"
import { toIsoDate, toIsoDatetime } from "../src/protocol/datetime"
import { parseLooseJson } from "../src/protocol/parse-json"
import { parseTables } from "../src/protocol/table"

describe("parseLooseJson, datetime & HTML table parsers", () => {
  it("preserves key-like text and escaped quotes inside payment names", () => {
    const name = 'Tuition, label: "first term" {amount: 10} \\ end'
    const raw = `{D:{name:${JSON.stringify(name)},amount:12.5}}`
    expect(parseLooseJson(raw)).toEqual({ D: { name, amount: 12.5 } })
    expect(parseLooseJson(JSON.stringify({ name }))).toEqual({ name })
  })

  it("rejects executable expressions and oversized responses", () => {
    expect(() => parseLooseJson("{D:globalThis.process.exit()}")).toThrow()
    expect(() => parseLooseJson(" ".repeat(2 * 1024 * 1024 + 1))).toThrow()
  })

  it("normalizes varied academic date and datetime strings", () => {
    expect(toIsoDate("2026.9.1")).toBe("2026-09-01")
    expect(toIsoDate("2026/09/05")).toBe("2026-09-05")
    expect(toIsoDatetime("2026.9.1 8:05")).toBe("2026-09-01T08:05:00")
    expect(toIsoDatetime("unrecognized")).toBe("unrecognized")
  })

  it("extracts top-level HTML tables and m-badge labels while ignoring nested detail tables", () => {
    const html = `
      <table>
        <thead><tr><th>活动名称</th><th>状态</th></tr></thead>
        <tbody>
          <tr>
            <td>校园清扫 <span class="m-badge">教师选择</span> <table><tr><td>nested</td></tr></table></td>
            <td><span class="m-badge">已通过</span></td>
          </tr>
        </tbody>
      </table>
    `
    const tables = parseTables(html)
    expect(tables).toHaveLength(1)
    expect(tables[0]!.headers).toEqual(["活动名称", "状态"])
    expect(tables[0]!.rows).toEqual([["校园清扫", "已通过"]])
    expect(tables[0]!.badges[0]).toEqual([["教师选择"], ["已通过"]])
  })
})
