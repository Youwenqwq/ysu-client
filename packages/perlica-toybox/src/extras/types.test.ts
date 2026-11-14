import { describe, expect, it, vi } from "vitest"
import {
  parsePerlicaToken,
  toPerlicaCurrentOrder,
  toPerlicaMachineList,
  toPerlicaMachineStatus,
  toPerlicaParkPoint,
  toPerlicaRideDetail,
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

  it("normalizes the ride-list field names, units, duration, and payment status", () => {
    const logs = toPerlicaRideLogs([
      {
        orderNO: "202611101071249471",
        machineNO: "019394061",
        userCode: "80477465",
        money: 150,
        mileage: 2.48,
        payStatus: 1,
        startTime: "2026-11-10 18:49:50",
        endTime: "2026-11-10 19:02:09",
        stopTime: 171,
      },
    ])
    expect(logs[0]).toMatchObject({
      orderNo: "202611101071249471",
      fee: 1.5,
      distance: 2480,
      duration: 739,
      status: "paid",
      startTime: "2026-11-10 18:49:50",
      endTime: "2026-11-10 19:02:09",
    })
  })

  it("parses detail timestamps and lon/lat pairs without applying list units", () => {
    const detail = toPerlicaRideDetail({
      orderId: "202611101071249471",
      actualPayMoney: 150,
      mileage: 2484,
      payStatus: 1,
      orderStartTime: "2026-11-10 18:49:50",
      orderEndTime: "2026-11-10 19:02:09",
      borrowAddress: "Start",
      returnAddress: "End",
      borrowLonLat: "119.51713,39.90531277777778",
      returnLonLat: "119.5288,39.90229",
    })
    expect(detail).toMatchObject({
      fee: 1.5,
      distance: 2484,
      duration: 739,
      status: "paid",
      startTime: "2026-11-10 18:49:50",
      endTime: "2026-11-10 19:02:09",
      startAddress: "Start",
      endAddress: "End",
      startLat: 39.90531277777778,
      startLng: 119.51713,
      endLat: 39.90229,
      endLng: 119.5288,
    })
  })

  it("parses the parking area polygon from the service coordinate string", () => {
    const point = toPerlicaParkPoint({
      parkPointId: 34176,
      name: "East gate",
      la: 39.901782,
      lo: 119.529017,
      points: "119.529103,39.901875;119.528934,39.901875;119.528927,39.90169;119.529105,39.901689",
    })
    expect(point.area).toHaveLength(4)
    expect(point.area[0]).toEqual({ lat: 39.901875, lng: 119.529103 })
    expect(point.area[2]).toEqual({ lat: 39.90169, lng: 119.528927 })
  })

  it("uses the battery heartbeat for online state and preserves the user code", () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date("2026-11-14T19:25:00Z"))
      const online = toPerlicaMachineStatus({
        machineNO: "80477421",
        batDt: "2026-11-15 03:25:06",
        posDt: "2026-11-15 03:21:03",
        socPercent: 19,
      })
      expect(online).toMatchObject({
        userCode: "80477421",
        machineNo: "",
        online: true,
        battery: 19,
      })
      expect(toPerlicaMachineStatus({ batDt: "2025-04-08 20:12:45" }).online).toBe(false)
      expect(toPerlicaMachineStatus({ online: false, batDt: "2026-11-15 03:25:06" }).online).toBe(
        false
      )
    } finally {
      vi.useRealTimers()
    }
  })
})
