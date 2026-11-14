import { describe, expect, it } from "vitest"
import { parsePerlicaCode } from "./scan"

describe("parsePerlicaCode", () => {
  it("reads machineNO from the QR link printed on vehicles", () => {
    expect(parsePerlicaCode("http://www.gpsabc.cn/QRcode_xlbcx.html?machineNO=80369677")).toBe(
      "80369677"
    )
  })

  it("continues to support plain codes and existing query parameters", () => {
    expect(parsePerlicaCode("80369677")).toBe("80369677")
    expect(parsePerlicaCode("https://example.invalid/?userCode=80369677")).toBe("80369677")
    expect(parsePerlicaCode("https://example.invalid/?code=80369677")).toBe("80369677")
  })

  it("rejects nonnumeric machineNO values", () => {
    expect(parsePerlicaCode("http://www.gpsabc.cn/QRcode_xlbcx.html?machineNO=abc")).toBeNull()
  })
})
