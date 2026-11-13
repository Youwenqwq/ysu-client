import { fetchStateless, type HttpResponse } from "@orahako/plugin-sdk/host"
import {
  toPerlicaCurrentOrder,
  toPerlicaDispatchCheck,
  toPerlicaGeoArea,
  toPerlicaMachineFee,
  toPerlicaMachineList,
  toPerlicaMachineStatus,
  toPerlicaOrder,
  toPerlicaParkPoints,
  toPerlicaRemandPoints,
  toPerlicaReturnCheck,
  toPerlicaRideCards,
  toPerlicaRideDetail,
  toPerlicaRideLogs,
  toPerlicaStations,
  toPerlicaUnreadCount,
  toPerlicaUserInfo,
  type PerlicaCoords,
  type PerlicaDispatchCheck,
  type PerlicaGeoArea,
  type PerlicaMachine,
  type PerlicaMachineFee,
  type PerlicaMachineStatus,
  type PerlicaOrder,
  type PerlicaParkPoint,
  type PerlicaPrepareResult,
  type PerlicaRemandPoint,
  type PerlicaReturnCheck,
  type PerlicaRideCard,
  type PerlicaRideDetail,
  type PerlicaRideLog,
  type PerlicaStation,
  type PerlicaUserInfo,
} from "./types"

const BASE_URL = "https://client3.uqbike.cn"
const DEFAULT_AD_ACCOUNT_ID = "11423"

export interface PerlicaConfig {
  token: string
  accountId: string
  adAccountId?: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function haversineDistance(a: PerlicaCoords, b: PerlicaCoords): number {
  const radians = Math.PI / 180
  const deltaLat = (b.lat - a.lat) * radians
  const deltaLng = (b.lng - a.lng) * radians
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(deltaLng / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function isStalePosition(value: unknown, now: number): boolean {
  if (value === null || value === undefined || value === "") return false
  let timestamp = Number.NaN
  if (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) {
    const numeric = Number(value)
    if (Number.isFinite(numeric))
      timestamp = Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  if (!Number.isFinite(timestamp) && typeof value === "string") {
    timestamp = Date.parse(value.replace(" ", "T"))
  }
  return Number.isFinite(timestamp) && now - timestamp > DAY_MS
}

export class PerlicaError extends Error {
  constructor(
    readonly ret: number,
    message: string
  ) {
    super(message)
    this.name = "PerlicaError"
  }
}

export class PerlicaClient {
  private readonly adAccountId: string

  constructor(private readonly config: PerlicaConfig) {
    this.adAccountId = config.adAccountId?.trim() || DEFAULT_AD_ACCOUNT_ID
  }

  private async call(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const query = new URLSearchParams({ token: this.config.token })
    for (const [key, value] of Object.entries(params)) query.set(key, String(value))

    let response: HttpResponse
    try {
      response = await fetchStateless({
        method: "GET",
        url: `${BASE_URL}${path}?${query.toString()}`,
        redirect: "manual",
        proxyTargetInHeader: true,
      })
    } catch {
      // Platform errors may include the complete request URL. Never propagate it.
      throw new PerlicaError(-1, "Network request failed")
    }

    if (response.status < 200 || response.status >= 300) {
      throw new PerlicaError(-1, `HTTP ${response.status}`)
    }

    let payload: unknown
    try {
      payload = JSON.parse(await response.text())
    } catch {
      throw new PerlicaError(-1, "Invalid server response")
    }
    const envelope =
      payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null
    if (!envelope) throw new PerlicaError(-1, "Invalid server response")

    const parsedRet = Number(envelope.ret)
    const ret = Number.isFinite(parsedRet) ? parsedRet : -1
    if (ret !== 1) {
      const serviceMessage = typeof envelope.msg === "string" ? envelope.msg : ""
      const redactedMessage = this.config.token
        ? serviceMessage.split(this.config.token).join("[redacted]")
        : serviceMessage
      const safeMessage = redactedMessage.replace(/https?:\/\/\S+/gi, "[URL removed]")
      throw new PerlicaError(ret, safeMessage || `Request failed (ret=${ret})`)
    }
    return envelope.data
  }

  async userInfo(): Promise<PerlicaUserInfo> {
    return toPerlicaUserInfo(
      await this.call("/user/getByUserId.do", { adAccountId: this.adAccountId })
    )
  }

  private async nearMachinesAtRadius(
    coords: PerlicaCoords,
    radius: number
  ): Promise<PerlicaMachine[]> {
    const machines = toPerlicaMachineList(
      await this.call("/machineStatus/getNearMachine.do", {
        accountId: this.config.accountId,
        mapType: 2,
        lo: coords.lng,
        la: coords.lat,
        adAccountId: this.adAccountId,
        radius,
        pageSize: 100,
      })
    )
    const now = Date.now()
    const sorted = machines
      .filter((machine) => machine.battery > 0 && !isStalePosition(machine.raw.posDt, now))
      .map((machine) => ({ ...machine, distance: haversineDistance(coords, machine) }))
      .sort((a, b) => a.distance - b.distance)

    const seen = new Set<string>()
    const unique: PerlicaMachine[] = []
    for (const machine of sorted) {
      const key = machine.userCode || machine.machineNo
      if (key && seen.has(key)) continue
      if (key) seen.add(key)
      unique.push(machine)
    }
    return unique
  }

  async nearMachines(coords: PerlicaCoords, radius = 3000): Promise<PerlicaMachine[]> {
    const machines = await this.nearMachinesAtRadius(coords, radius)
    if (machines.length > 0 || radius === 10000) return machines
    return this.nearMachinesAtRadius(coords, 10000)
  }

  async currentOrder(): Promise<PerlicaOrder | null> {
    return toPerlicaCurrentOrder(await this.call("/machine/getBorrowing.do", { online: 1 }))
  }

  async rideLogs(page = 1, size = 20): Promise<PerlicaRideLog[]> {
    return toPerlicaRideLogs(
      await this.call("/rideLog/queryPage.do", { rowCount: size, pageNO: page })
    )
  }

  async rideCards(coords: PerlicaCoords, page = 1, size = 20): Promise<PerlicaRideCard[]> {
    return toPerlicaRideCards(
      await this.call("/rideCardUser/queryPage.do", {
        pageNO: page,
        rowCount: size,
        adAccountId: this.adAccountId,
        lo: coords.lng,
        la: coords.lat,
      })
    )
  }

  async machineStatus(machineNo: string): Promise<PerlicaMachineStatus> {
    return toPerlicaMachineStatus(
      await this.call("/machineStatus/getByMachineNO.do", { userCode: machineNo })
    )
  }

  async machineFee(machineNo: string): Promise<PerlicaMachineFee> {
    return toPerlicaMachineFee(
      await this.call("/accountFee/getByMachineNO.do", { machineNO: machineNo })
    )
  }

  async prepareMachine(machineNo: string, coords: PerlicaCoords): Promise<PerlicaPrepareResult> {
    await this.call("/machine/addNum.do", { userCode: machineNo })
    await this.call("/machine/isSupport.do", { userCode: machineNo })
    const position = await this.call("/machine/lastUse.do", {
      mapType: 2,
      userCode: machineNo,
      lo: coords.lng,
      la: coords.lat,
    })
    const popup = await this.call("/machine/validPopUp.do", {
      mapType: 2,
      lon: coords.lng,
      lat: coords.lat,
      userCode: machineNo,
    })
    const popupRecord: Record<string, unknown> =
      popup !== null && typeof popup === "object" && !Array.isArray(popup)
        ? (popup as Record<string, unknown>)
        : {}
    const warnings: string[] = []
    for (const key of ["outOfRangePopUp", "tooFarPopUp"]) {
      const text = popupRecord[key]
      if (typeof text === "string" && text.trim()) warnings.push(text.trim())
    }
    return {
      borrowPosLogId:
        typeof position === "string" || typeof position === "number" ? String(position) : "",
      warnings,
    }
  }

  async borrowBike(
    machineNo: string,
    coords: PerlicaCoords,
    borrowPosLogId?: string
  ): Promise<PerlicaOrder> {
    const params: Record<string, string | number> = {
      userCode: machineNo,
      orderSource: 3,
      lon: coords.lng,
      lat: coords.lat,
    }
    if (borrowPosLogId?.trim()) params.borrowPosLogId = borrowPosLogId.trim()
    return toPerlicaOrder(await this.call("/machine/borrowBike.do", params))
  }

  async ring(userCode: string, machineNo: string, coords: PerlicaCoords): Promise<void> {
    await this.call("/terControl/sendControl.do", {
      userCode,
      machineNO: machineNo,
      controlType: "control",
      paramName: 9,
      lon: coords.lng,
      lat: coords.lat,
      mapType: 2,
    })
  }

  async returnCheck(machineNo: string): Promise<PerlicaReturnCheck> {
    return toPerlicaReturnCheck(
      await this.call("/dispatch/returnCheck.do", { userCode: machineNo })
    )
  }

  async dispatchCheck(orderNo: string, coords: PerlicaCoords): Promise<PerlicaDispatchCheck> {
    return toPerlicaDispatchCheck(
      await this.call("/dispatch/check.do", {
        mapType: 2,
        combineDispatch: 1,
        orderNo,
        lo: coords.lng,
        la: coords.lat,
        phoneTimeStamp: Date.now(),
        accuracy: 100,
      })
    )
  }

  async returnBike(orderNo: string, coords: PerlicaCoords): Promise<void> {
    await this.call("/machine/returnBike.do", {
      dispatchType: 1,
      orderSource: 3,
      orderNo,
      la: coords.lat,
      lo: coords.lng,
    })
  }

  private async parkCommand(
    path: string,
    orderNo: string,
    userCode: string,
    coords: PerlicaCoords
  ): Promise<void> {
    try {
      await this.call(path, {
        orderNo,
        userCode,
        orderSource: 3,
        mapType: 2,
        lo: coords.lng,
        la: coords.lat,
      })
    } catch {
      await this.call(path, { orderNo, mapType: 2, lo: coords.lng, la: coords.lat })
    }
  }

  async parkRide(orderNo: string, userCode: string, coords: PerlicaCoords): Promise<void> {
    await this.parkCommand("/park/parkRide.do", orderNo, userCode, coords)
  }

  async continueRide(orderNo: string, userCode: string, coords: PerlicaCoords): Promise<void> {
    await this.parkCommand("/park/continueRide.do", orderNo, userCode, coords)
  }

  async parkPoints(coords: PerlicaCoords, radius = 5000): Promise<PerlicaParkPoint[]> {
    return toPerlicaParkPoints(
      await this.call("/parkPoint/getNear.do", {
        mapType: 2,
        lo: coords.lng,
        la: coords.lat,
        radius,
        pageSize: 200,
        accountId: this.adAccountId,
      })
    )
  }

  async geoArea(coords: PerlicaCoords): Promise<PerlicaGeoArea> {
    return toPerlicaGeoArea(
      await this.call("/geo/getInGeo.do", {
        lo: coords.lng,
        la: coords.lat,
        mapType: 2,
        accountId: this.config.accountId,
        adAccountId: this.adAccountId,
      })
    )
  }

  async rideDetail(orderNo: string): Promise<PerlicaRideDetail> {
    return toPerlicaRideDetail(
      await this.call("/rideLogDetails/queryByOrderNO.do", { orderNO: orderNo })
    )
  }

  async stations(coords: PerlicaCoords): Promise<PerlicaStation[]> {
    return toPerlicaStations(
      await this.call("/adAccount/getByLocation.do", {
        accountId: this.config.accountId,
        mapType: 2,
        lo: coords.lng,
        la: coords.lat,
      })
    )
  }

  async remandPoints(): Promise<PerlicaRemandPoint[]> {
    return toPerlicaRemandPoints(await this.call("/machine/getRemand.do"))
  }

  async unreadCount(): Promise<number> {
    return toPerlicaUnreadCount(await this.call("/userMsg/getNotRead.do"))
  }
}
