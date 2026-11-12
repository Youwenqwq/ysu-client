import { describe, expect, it } from "vitest"
import { parseLooseJson } from "./parse-json"

describe("parseLooseJson", () => {
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
})
