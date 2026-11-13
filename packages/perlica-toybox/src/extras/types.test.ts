import { describe, expect, it } from "vitest"
import {
  parsePerlicaToken,
  toPerlicaCurrentOrder,
  toPerlicaMachineList,
  toPerlicaRideLogs,
  toPerlicaUserInfo,
} from "./types"

const TOKEN = "TOKEN:10001:20002:00000000-0000-4000-8000-000000000000"

describe("parsePerlicaToken", () => {
  it("extracts the three identity fields from a raw token", () => {
    expect(parsePerlicaToken(TOKEN)).toEqual({
      token: TOKEN,
      accountId: "10001",
      userId: "20002",
    })
  })

  it("extracts and decodes a token from a pasted URL", () => {
    const url = `https://example.invalid/callback?token=${encodeURIComponent(TOKEN)}&from=test`
    expect(parsePerlicaToken(url)).toEqual({
      token: TOKEN,
      accountId: "10001",
      userId: "20002",
    })
    expect(parsePerlicaToken(`Copied login link: ${url}`).userId).toBe("20002")
  })

  it("rejects missing or extra token segments and malformed UUIDs", () => {
    expect(() => parsePerlicaToken("TOKEN:10001:20002")).toThrow("Invalid Perlica token")
    expect(() => parsePerlicaToken(`${TOKEN}:extra`)).toThrow("Invalid Perlica token")
    expect(() => parsePerlicaToken("TOKEN:10001:20002:not-a-uuid")).toThrow("Invalid Perlica token")
    expect(() => parsePerlicaToken("https://example.invalid/?token=none")).toThrow(
      "Invalid Perlica token"
    )
  })
})

describe("Perlica response normalization", () => {
  it("accepts an array user response and normalizes numeric strings", () => {
    const user = toPerlicaUserInfo([
      {
        id: 20002,
        account_id: "10001",
        nickname: "Rider",
        balance: "12.50",
        depositMoney: "99",
        rideCardDate: "2026-12-01",
      },
    ])
    expect(user).toMatchObject({
      userId: "20002",
      accountId: "10001",
      balance: 12.5,
      deposit: 99,
      rideCardDate: "2026-12-01",
    })
  })

  it.each(["list", "records", "rows"])("reads machine arrays wrapped in %s", (key) => {
    const machines = toPerlicaMachineList({
      [key]: [
        {
          userCode: "12345678",
          machineNO: "123456789",
          la: "30.1",
          lo: "120.2",
          battery: "87",
        },
      ],
    })
    expect(machines).toHaveLength(1)
    expect(machines[0]).toMatchObject({
      userCode: "12345678",
      machineNo: "123456789",
      lat: 30.1,
      lng: 120.2,
      battery: 87,
    })
  })

  it("reads ride logs from records and normalizes order metrics", () => {
    const logs = toPerlicaRideLogs({
      records: [
        {
          orderNo: 456,
          machineNO: 123,
          totalFee: "2.5",
          duration: "600",
          distance: "1200",
        },
      ],
    })
    expect(logs[0]).toMatchObject({
      orderNo: "456",
      machineNo: "123",
      fee: 2.5,
      duration: 600,
      distance: 1200,
    })
  })

  it("does not derive machineNo from the independent userCode", () => {
    const machines = toPerlicaMachineList([{ userCode: "12345678" }])
    expect(machines[0]).toMatchObject({ userCode: "12345678", machineNo: "" })
    expect(toPerlicaCurrentOrder({ orderNo: 9, userCode: "12345678" })).toMatchObject({
      userCode: "12345678",
      machineNo: "",
    })
  })

  it("treats null, empty arrays, and empty objects as no current order", () => {
    expect(toPerlicaCurrentOrder(null)).toBeNull()
    expect(toPerlicaCurrentOrder([])).toBeNull()
    expect(toPerlicaCurrentOrder({})).toBeNull()
    expect(toPerlicaCurrentOrder({ order: {} })).toBeNull()
    expect(toPerlicaCurrentOrder([{ orderNo: 456 }])?.orderNo).toBe("456")
  })
})
