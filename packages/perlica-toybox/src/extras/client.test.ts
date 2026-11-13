import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpRequest, HttpResponse } from "@ysu/plugin-sdk/host"

const sendMock = vi.fn<(req: HttpRequest) => Promise<HttpResponse>>()

vi.mock("@ysu/plugin-sdk/host", () => ({
  fetchStateless: (req: HttpRequest) => sendMock(req),
}))

import { PerlicaClient, PerlicaError } from "./client"

const TOKEN = "TOKEN:10001:20002:00000000-0000-4000-8000-000000000000"
const CONFIG = { token: TOKEN, accountId: "10001" }
const COORDS = { lat: 30.123, lng: 120.456 }

function okResponse(data: unknown): HttpResponse {
  return {
    status: 200,
    headers: {},
    url: "",
    text: async () => JSON.stringify({ ret: 1, data, msg: "" }),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function capturedUrl(call = 0): URL {
  return new URL(sendMock.mock.calls[call]![0].url)
}

beforeEach(() => {
  sendMock.mockReset()
})

describe("PerlicaClient request contract", () => {
  it("places authentication and user parameters in the URL query", async () => {
    sendMock.mockResolvedValue(okResponse({ rideCardDate: "2026-12-01" }))
    await expect(new PerlicaClient(CONFIG).userInfo()).resolves.toMatchObject({
      rideCardDate: "2026-12-01",
    })

    const req = sendMock.mock.calls[0]![0]
    const url = capturedUrl()
    expect(req.method).toBe("GET")
    expect(req.body).toBeUndefined()
    expect(req).toMatchObject({ proxyTargetInHeader: true })
    expect(url.origin).toBe("https://client3.uqbike.cn")
    expect(url.pathname).toBe("/user/getByUserId.do")
    expect(url.searchParams.get("token")).toBe(TOKEN)
    expect(url.searchParams.get("adAccountId")).toBe("11423")
    expect(req.headers).toBeUndefined()
  })

  it("sends map coordinates, account IDs, radius, and page size for nearby vehicles", async () => {
    sendMock.mockResolvedValue(
      okResponse([
        {
          userCode: "12345678",
          machineNO: "123456789",
          soc: 80,
          lat: COORDS.lat,
          lon: COORDS.lng,
        },
      ])
    )
    const client = new PerlicaClient({ ...CONFIG, adAccountId: "custom-ad" })
    await client.nearMachines(COORDS)

    const url = capturedUrl()
    expect(url.pathname).toBe("/machineStatus/getNearMachine.do")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: TOKEN,
      accountId: "10001",
      mapType: "2",
      lo: "120.456",
      la: "30.123",
      adAccountId: "custom-ad",
      radius: "3000",
      pageSize: "100",
    })
    expect(sendMock).toHaveBeenCalledOnce()
  })

  it("filters unusable vehicles, retries at 10000 meters, sorts, and deduplicates", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-02T00:00:00Z"))
    try {
      sendMock
        .mockResolvedValueOnce(
          okResponse([
            { userCode: "00000000", soc: 0, lat: COORDS.lat, lon: COORDS.lng },
            {
              userCode: "33333333",
              soc: 80,
              posDt: "2026-10-31 23:59:59",
              lat: COORDS.lat,
              lon: COORDS.lng,
            },
          ])
        )
        .mockResolvedValueOnce(
          okResponse([
            { userCode: "11111111", machineNO: "999999999", soc: 80, lat: 30.124, lon: 120.456 },
            { userCode: "11111111", machineNO: "888888888", soc: 90, lat: 30.1231, lon: 120.456 },
            { userCode: "22222222", machineNO: "777777777", soc: 70, lat: 30.126, lon: 120.456 },
          ])
        )

      const machines = await new PerlicaClient(CONFIG).nearMachines(COORDS)
      expect(machines.map((machine) => machine.userCode)).toEqual(["11111111", "22222222"])
      expect(machines[0]).toMatchObject({ machineNo: "888888888" })
      expect(machines[0]!.distance).toBeGreaterThan(0)
      expect(machines[0]!.distance).toBeLessThan(machines[1]!.distance)
      expect(capturedUrl(0).searchParams.get("radius")).toBe("3000")
      expect(capturedUrl(1).searchParams.get("radius")).toBe("10000")
      expect(sendMock).toHaveBeenCalledTimes(2)
    } finally {
      now.mockRestore()
    }
  })

  it("uses rowCount/pageNO and unwraps ride-log records", async () => {
    sendMock.mockResolvedValue(okResponse({ records: [{ orderNo: 9, fee: "3.5" }] }))
    await expect(new PerlicaClient(CONFIG).rideLogs(4, 50)).resolves.toMatchObject([
      { orderNo: "9", fee: 3.5 },
    ])
    const url = capturedUrl()
    expect(url.pathname).toBe("/rideLog/queryPage.do")
    expect(url.searchParams.get("rowCount")).toBe("50")
    expect(url.searchParams.get("pageNO")).toBe("4")
  })

  it("queries ride cards and retains only valid cards", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        records: [
          {
            name: "Monthly",
            feeName: "Standard",
            startDate: "2026-11-01",
            dueTime: "2026-12-01",
            remainingCount: "8",
            maxRide: "10",
            useCount: "2",
            timeCount: "30",
            currentNum: "1",
            isValid: "1",
          },
          { name: "Expired", isValid: 0 },
        ],
      })
    )
    const cards = await new PerlicaClient(CONFIG).rideCards(COORDS, 2, 30)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      name: "Monthly",
      feeName: "Standard",
      remainingCount: 8,
      maxRide: 10,
      useCount: 2,
      timeCount: 30,
      currentNum: 1,
      isValid: true,
    })
    expect(Object.fromEntries(capturedUrl().searchParams)).toEqual({
      token: TOKEN,
      pageNO: "2",
      rowCount: "30",
      adAccountId: "11423",
      lo: "120.456",
      la: "30.123",
    })
  })

  it("normalizes direct arrays for nearby vehicles and the current order", async () => {
    const client = new PerlicaClient(CONFIG)
    sendMock.mockResolvedValueOnce(
      okResponse([
        {
          userCode: "12345678",
          machineNO: "123456789",
          battery: "76",
          la: "30.1",
          lo: "120.2",
        },
      ])
    )
    await expect(client.nearMachines(COORDS)).resolves.toMatchObject([
      {
        userCode: "12345678",
        machineNo: "123456789",
        battery: 76,
        lat: 30.1,
        lng: 120.2,
      },
    ])

    sendMock.mockResolvedValueOnce(
      okResponse([{ orderNo: 456, userCode: "12345678", machineNO: "123456789" }])
    )
    await expect(client.currentOrder()).resolves.toMatchObject({
      orderNo: "456",
      userCode: "12345678",
      machineNo: "123456789",
    })
    expect(capturedUrl(1).pathname).toBe("/machine/getBorrowing.do")
    expect(capturedUrl(1).searchParams.get("online")).toBe("1")
  })

  it.each([null, [], {}, [null], { order: {} }])(
    "maps an empty current-order response %# to null",
    async (data) => {
      sendMock.mockResolvedValue(okResponse(data))
      await expect(new PerlicaClient(CONFIG).currentOrder()).resolves.toBeNull()
    }
  )

  it("sends exact vehicle status, fee, and basic borrow parameters", async () => {
    const client = new PerlicaClient(CONFIG)
    sendMock.mockResolvedValue(okResponse({}))

    await client.machineStatus("12345678")
    expect(capturedUrl(0).pathname).toBe("/machineStatus/getByMachineNO.do")
    expect(capturedUrl(0).searchParams.get("userCode")).toBe("12345678")

    await client.machineFee("12345678")
    expect(capturedUrl(1).pathname).toBe("/accountFee/getByMachineNO.do")
    expect(capturedUrl(1).searchParams.get("machineNO")).toBe("12345678")

    await client.borrowBike("12345678", COORDS)
    const borrow = capturedUrl(2)
    expect(borrow.pathname).toBe("/machine/borrowBike.do")
    expect(Object.fromEntries(borrow.searchParams)).toEqual({
      token: TOKEN,
      userCode: "12345678",
      orderSource: "3",
      lon: "120.456",
      lat: "30.123",
    })
  })

  it("prepares a vehicle in order and only sends a nonempty borrowPosLogId", async () => {
    const client = new PerlicaClient(CONFIG)
    sendMock
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce(okResponse("POS-9"))
      .mockResolvedValueOnce(
        okResponse({ outOfRangePopUp: " Outside range ", tooFarPopUp: "Too far" })
      )
      .mockResolvedValue(okResponse({}))

    await expect(client.prepareMachine("12345678", COORDS)).resolves.toEqual({
      borrowPosLogId: "POS-9",
      warnings: ["Outside range", "Too far"],
    })
    expect(sendMock.mock.calls.slice(0, 4).map(([req]) => new URL(req.url).pathname)).toEqual([
      "/machine/addNum.do",
      "/machine/isSupport.do",
      "/machine/lastUse.do",
      "/machine/validPopUp.do",
    ])
    expect(Object.fromEntries(capturedUrl(2).searchParams)).toEqual({
      token: TOKEN,
      mapType: "2",
      userCode: "12345678",
      lo: "120.456",
      la: "30.123",
    })
    expect(Object.fromEntries(capturedUrl(3).searchParams)).toEqual({
      token: TOKEN,
      mapType: "2",
      lon: "120.456",
      lat: "30.123",
      userCode: "12345678",
    })

    await client.borrowBike("12345678", COORDS, "POS-9")
    expect(capturedUrl(4).searchParams.get("borrowPosLogId")).toBe("POS-9")
    await client.borrowBike("12345678", COORDS, "  ")
    expect(capturedUrl(5).searchParams.has("borrowPosLogId")).toBe(false)
  })

  it("sends the complete ringing query with both vehicle identifiers", async () => {
    sendMock.mockResolvedValue(okResponse({}))
    await new PerlicaClient(CONFIG).ring("12345678", "123456789", COORDS)
    const url = capturedUrl()
    expect(url.pathname).toBe("/terControl/sendControl.do")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: TOKEN,
      userCode: "12345678",
      machineNO: "123456789",
      controlType: "control",
      paramName: "9",
      lon: "120.456",
      lat: "30.123",
      mapType: "2",
    })
  })

  it("keeps return-check, dispatch-check, and return calls in order", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1780000000123)
    try {
      const client = new PerlicaClient(CONFIG)
      sendMock
        .mockResolvedValueOnce(okResponse({ allowed: true }))
        .mockResolvedValueOnce(
          okResponse({
            studyToReduceDispatch: false,
            type: 1,
            types: [{ money: "0", type: "1" }],
          })
        )
        .mockResolvedValueOnce(okResponse({}))

      await client.returnCheck("M-100")
      const dispatch = await client.dispatchCheck("ORDER-9", COORDS)
      expect(dispatch).toMatchObject({
        allowed: true,
        dispatchType: 1,
        options: [{ type: 1, money: 0 }],
      })
      await client.returnBike("ORDER-9", COORDS)

      expect(sendMock.mock.calls.map(([req]) => new URL(req.url).pathname)).toEqual([
        "/dispatch/returnCheck.do",
        "/dispatch/check.do",
        "/machine/returnBike.do",
      ])
      expect(capturedUrl(0).searchParams.get("userCode")).toBe("M-100")
      expect(Object.fromEntries(capturedUrl(1).searchParams)).toEqual({
        token: TOKEN,
        mapType: "2",
        combineDispatch: "1",
        orderNo: "ORDER-9",
        lo: "120.456",
        la: "30.123",
        phoneTimeStamp: "1780000000123",
        accuracy: "100",
      })
      expect(Object.fromEntries(capturedUrl(2).searchParams)).toEqual({
        token: TOKEN,
        dispatchType: "1",
        orderSource: "3",
        orderNo: "ORDER-9",
        la: "30.123",
        lo: "120.456",
      })
    } finally {
      now.mockRestore()
    }
  })

  it("uses full parking parameters and retries continue with the reduced query", async () => {
    sendMock
      .mockResolvedValueOnce(okResponse({}))
      .mockResolvedValueOnce({
        ...okResponse(null),
        text: async () => JSON.stringify({ ret: 0, data: null, msg: "Unsupported" }),
      })
      .mockResolvedValue(okResponse({}))
    const client = new PerlicaClient(CONFIG)
    await client.parkRide("ORDER-9", "12345678", COORDS)
    await client.continueRide("ORDER-9", "12345678", COORDS)

    expect(sendMock.mock.calls.map(([req]) => new URL(req.url).pathname)).toEqual([
      "/park/parkRide.do",
      "/park/continueRide.do",
      "/park/continueRide.do",
    ])
    const fullQuery = {
      token: TOKEN,
      orderNo: "ORDER-9",
      userCode: "12345678",
      orderSource: "3",
      mapType: "2",
      lo: "120.456",
      la: "30.123",
    }
    expect(Object.fromEntries(capturedUrl(0).searchParams)).toEqual(fullQuery)
    expect(Object.fromEntries(capturedUrl(1).searchParams)).toEqual(fullQuery)
    expect(Object.fromEntries(capturedUrl(2).searchParams)).toEqual({
      token: TOKEN,
      orderNo: "ORDER-9",
      mapType: "2",
      lo: "120.456",
      la: "30.123",
    })
  })

  it("queries and normalizes nearby parking points", async () => {
    sendMock.mockResolvedValue(
      okResponse({ records: [{ id: 1, name: "Lot", lat: "30.1", lon: "120.2" }] })
    )
    const points = await new PerlicaClient(CONFIG).parkPoints(COORDS, 6000)
    expect(points).toMatchObject([{ id: "1", name: "Lot", lat: 30.1, lng: 120.2 }])
    expect(Object.fromEntries(capturedUrl().searchParams)).toEqual({
      token: TOKEN,
      mapType: "2",
      lo: "120.456",
      la: "30.123",
      radius: "6000",
      pageSize: "200",
      accountId: "11423",
    })
  })

  it("parses geo fences with numeric strings", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        pointList: [{ x: "120.1", y: "30.1" }],
        centerLa: "30.2",
        centerLo: "120.2",
        finishOrderSwitch: 1,
        finishTime: "10",
        stopTime: "20",
      })
    )
    await expect(new PerlicaClient(CONFIG).geoArea(COORDS)).resolves.toMatchObject({
      pointList: [{ x: 120.1, y: 30.1 }],
      centerLat: 30.2,
      centerLng: 120.2,
      finishOrderSwitch: true,
      finishTime: 10,
      stopTime: 20,
    })
    expect(Object.fromEntries(capturedUrl().searchParams)).toEqual({
      token: TOKEN,
      lo: "120.456",
      la: "30.123",
      mapType: "2",
      accountId: "10001",
      adAccountId: "11423",
    })
  })

  it("retains and normalizes ride detail endpoints and metrics", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        orderNO: 9,
        userCode: "12345678",
        machineNO: "123456789",
        startAddress: "Start",
        endAddress: "End",
        startLa: "30.1",
        startLo: "120.1",
        endLa: "30.2",
        endLo: "120.2",
        totalFee: "3.5",
        rideDistance: "1200",
        rideTime: "600",
        borrowTime: "2026-11-01 10:00:00",
        returnTime: "2026-11-01 10:10:00",
      })
    )
    const detail = await new PerlicaClient(CONFIG).rideDetail("ORDER-9")
    expect(detail).toMatchObject({
      orderNo: "9",
      userCode: "12345678",
      machineNo: "123456789",
      startAddress: "Start",
      endAddress: "End",
      startLat: 30.1,
      startLng: 120.1,
      endLat: 30.2,
      endLng: 120.2,
      fee: 3.5,
      distance: 1200,
      duration: 600,
      startTime: "2026-11-01 10:00:00",
      endTime: "2026-11-01 10:10:00",
    })
    expect(detail.raw.totalFee).toBe("3.5")
    expect(capturedUrl().pathname).toBe("/rideLogDetails/queryByOrderNO.do")
    expect(capturedUrl().searchParams.get("orderNO")).toBe("ORDER-9")
  })

  it("queries stations and preserves their identity and coordinates", async () => {
    sendMock.mockResolvedValue(
      okResponse({
        list: [
          {
            stationId: "station-1",
            stationName: "Central",
            accountId: 10001,
            la: "30.1",
            lo: "120.1",
          },
        ],
      })
    )
    const stations = await new PerlicaClient(CONFIG).stations(COORDS)
    expect(stations).toMatchObject([
      { id: "station-1", name: "Central", accountId: "10001", lat: 30.1, lng: 120.1 },
    ])
    expect(Object.fromEntries(capturedUrl().searchParams)).toEqual({
      token: TOKEN,
      accountId: "10001",
      mapType: "2",
      lo: "120.456",
      la: "30.123",
    })
  })

  it("normalizes remand points and unread counts", async () => {
    const client = new PerlicaClient(CONFIG)
    sendMock.mockResolvedValueOnce(
      okResponse([{ remandId: 7, pointName: "Remand", x: "120.1", y: "30.1" }])
    )
    await expect(client.remandPoints()).resolves.toMatchObject([
      { id: "7", name: "Remand", lat: 30.1, lng: 120.1 },
    ])
    expect(capturedUrl(0).pathname).toBe("/machine/getRemand.do")

    sendMock.mockResolvedValueOnce(okResponse({ notRead: "7" }))
    await expect(client.unreadCount()).resolves.toBe(7)
    expect(capturedUrl(1).pathname).toBe("/userMsg/getNotRead.do")
  })
})

describe("PerlicaClient errors", () => {
  it("throws a PerlicaError with ret for an unsuccessful envelope", async () => {
    sendMock.mockResolvedValue({
      ...okResponse(null),
      text: async () => JSON.stringify({ ret: 403, data: null, msg: "Operation denied" }),
    })
    const error = await new PerlicaClient(CONFIG).userInfo().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PerlicaError)
    expect(error).toMatchObject({ ret: 403, message: "Operation denied" })
  })

  it("reports HTTP failures without exposing the request URL or token", async () => {
    sendMock.mockResolvedValue({ ...okResponse(null), status: 503 })
    const error = await new PerlicaClient(CONFIG).userInfo().catch((e: unknown) => e)
    expect(error).toMatchObject({ ret: -1, message: "HTTP 503" })
    expect((error as Error).message).not.toContain(TOKEN)
    expect((error as Error).message).not.toContain("client3.uqbike.cn")
  })

  it("sanitizes transport errors that contain the complete authenticated URL", async () => {
    const authenticatedUrl = `https://client3.uqbike.cn/user/getByUserId.do?token=${encodeURIComponent(TOKEN)}`
    sendMock.mockRejectedValue(new Error(`fetch failed: ${authenticatedUrl}`))
    const error = await new PerlicaClient(CONFIG).userInfo().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PerlicaError)
    expect(error).toMatchObject({ ret: -1, message: "Network request failed" })
    expect((error as Error).message).not.toContain(TOKEN)
    expect((error as Error).message).not.toContain(authenticatedUrl)
  })
})
