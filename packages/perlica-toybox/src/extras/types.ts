export interface PerlicaCoords {
  lat: number
  lng: number
}

export interface PerlicaTokenParts {
  token: string
  accountId: string
  userId: string
}

export type PerlicaRaw = Record<string, unknown>

export interface PerlicaUserInfo {
  userId: string
  accountId: string
  nickname: string
  phone: string
  avatarUrl: string
  balance: number
  deposit: number
  /** Monthly-card expiry text supplied by the service. */
  rideCardDate: string
  raw: PerlicaRaw
}

export interface PerlicaMachine {
  /** Eight-digit ID printed on the vehicle and returned by its QR machineNO parameter. */
  userCode: string
  /** Nine-digit internal number used by the ring command; not shown in normal UI. */
  machineNo: string
  name: string
  address: string
  lat: number
  lng: number
  distance: number
  battery: number
  status: string
  raw: PerlicaRaw
}

export interface PerlicaOrder {
  orderNo: string
  userCode: string
  machineNo: string
  startTime: string
  endTime: string
  status: string
  fee: number
  raw: PerlicaRaw
}

export interface PerlicaRideLog extends PerlicaOrder {
  duration: number
  distance: number
}

export interface PerlicaMachineStatus {
  userCode: string
  machineNo: string
  status: string
  battery: number
  online: boolean
  lat: number
  lng: number
  raw: PerlicaRaw
}

export interface PerlicaMachineFee {
  machineNo: string
  fee: number
  price: number
  unit: string
  description: string
  raw: PerlicaRaw
}

export interface PerlicaReturnCheck {
  allowed: boolean
  dispatchType: number
  message: string
  raw: PerlicaRaw
}

export interface PerlicaDispatchOption {
  type: number
  /** Dispatch fee in yuan; the service returns money fields in cents. */
  money: number
}

export interface PerlicaDispatchCheck extends PerlicaReturnCheck {
  options: PerlicaDispatchOption[]
}

export interface PerlicaPrepareResult {
  borrowPosLogId: string
  warnings: string[]
}

export interface PerlicaRideCard {
  name: string
  feeName: string
  startDate: string
  dueTime: string
  remainingCount: number
  maxRide: number
  useCount: number
  timeCount: number
  currentNum: number
  isValid: boolean
  raw: PerlicaRaw
}

export interface PerlicaParkPoint {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  distance: number
  /** WGS-84 polygon vertices supplied by the parking-point endpoint. */
  area: PerlicaCoords[]
  raw: PerlicaRaw
}

export interface PerlicaStation extends PerlicaParkPoint {
  accountId: string
}

export type PerlicaRemandPoint = PerlicaParkPoint

export interface PerlicaGeoPoint {
  x: number
  y: number
}

export interface PerlicaGeoArea {
  pointList: PerlicaGeoPoint[]
  centerLat: number
  centerLng: number
  finishOrderSwitch: boolean
  finishTime: number
  stopTime: number
  raw: PerlicaRaw
}

export interface PerlicaRideDetail extends PerlicaRideLog {
  startAddress: string
  endAddress: string
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  /** Chronological WGS-84 GPS points recorded during the ride. */
  route: PerlicaCoords[]
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
const TOKEN_PATTERN = new RegExp(`TOKEN:([^:\\s&?#]+):([^:\\s&?#]+):(${UUID})(?!:)`)

/** Extract a token from its raw form, a URL, or pasted diagnostic text. */
export function parsePerlicaToken(input: string): PerlicaTokenParts {
  const source = input.trim()
  const candidates = [source]
  try {
    const decoded = decodeURIComponent(source)
    if (decoded !== source) candidates.push(decoded)
  } catch {
    // The undecoded source can still contain a valid token.
  }

  for (const candidate of candidates) {
    const match = TOKEN_PATTERN.exec(candidate)
    if (!match) continue
    const token = match[0]
    return { token, accountId: match[1]!, userId: match[2]! }
  }
  throw new Error("Invalid Perlica token")
}

function asRecord(value: unknown): PerlicaRaw | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as PerlicaRaw)
    : null
}

function unwrapRecord(data: unknown, wrappers: string[] = []): PerlicaRaw | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const record = unwrapRecord(item, wrappers)
      if (record) return record
    }
    return null
  }
  const record = asRecord(data)
  if (!record) return null
  for (const key of wrappers) {
    if (record[key] !== null && typeof record[key] === "object") {
      const nested = unwrapRecord(record[key], wrappers)
      if (nested) return nested
    }
  }
  return record
}

function listRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  const record = asRecord(data)
  if (!record) return []
  for (const key of ["list", "records", "rows"]) {
    if (Array.isArray(record[key])) return record[key]
  }
  return []
}

function rawString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

function rawNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function rawBoolean(...values: unknown[]): boolean {
  for (const value of values) {
    if (value === true || value === 1 || value === "1" || value === "true") return true
    if (value === false || value === 0 || value === "0" || value === "false") return false
  }
  return false
}

function rawOptionalBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (value === true || value === 1 || value === "1" || value === "true") return true
    if (value === false || value === 0 || value === "0" || value === "false") return false
  }
  return null
}

function rawOptionalNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}

/** Naive service timestamps are China Standard Time, not the device's local zone. */
function serviceTimestamp(value: unknown): number | null {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    return Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric
  }
  const text = rawString(value).trim()
  if (!text) return null
  const normalized = text.replace(" ", "T")
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`
  const timestamp = Date.parse(withZone)
  return Number.isFinite(timestamp) ? timestamp : null
}

function durationBetween(startTime: string, endTime: string): number | null {
  const start = serviceTimestamp(startTime)
  const end = serviceTimestamp(endTime)
  if (start === null || end === null || end < start) return null
  return Math.floor((end - start) / 1000)
}

function lonLat(value: unknown): PerlicaCoords | null {
  if (typeof value !== "string") return null
  const [lng, lat, ...rest] = value.split(",").map((part) => Number(part.trim()))
  if (rest.length > 0 || lng === undefined || lat === undefined) return null
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    (lat === 0 && lng === 0)
  ) {
    return null
  }
  return { lat, lng }
}

function coordinateList(value: unknown): PerlicaCoords[] {
  if (typeof value !== "string") return []
  return value
    .split(";")
    .map(lonLat)
    .filter((point): point is PerlicaCoords => point !== null)
}

function machineNo(record: PerlicaRaw): string {
  return rawString(record.machineNo, record.machineNO, record.machine_no, record.code)
}

function userCode(record: PerlicaRaw): string {
  return rawString(record.userCode, record.user_code)
}

function orderNo(record: PerlicaRaw): string {
  return rawString(record.orderNo, record.orderNO, record.orderId, record.order_no, record.id)
}

export function toPerlicaUserInfo(data: unknown): PerlicaUserInfo {
  const raw = unwrapRecord(data, ["userInfo", "user_info", "user"]) ?? {}
  return {
    userId: rawString(raw.userId, raw.userID, raw.user_id, raw.id),
    accountId: rawString(raw.accountId, raw.accountID, raw.account_id),
    nickname: rawString(raw.nickname, raw.nickName, raw.userNickname, raw.name, raw.userName),
    phone: rawString(raw.phone, raw.phoneNumber, raw.mobile),
    avatarUrl: rawString(raw.avatarUrl, raw.avatar, raw.headImgUrl, raw.headimgurl),
    balance: rawNumber(raw.balance, raw.accountBalance, raw.money),
    deposit: rawNumber(raw.deposit, raw.depositMoney, raw.depositAmount),
    rideCardDate: rawString(raw.rideCardDate, raw.ride_card_date, raw.cardDate),
    raw,
  }
}

export function toPerlicaMachine(data: unknown): PerlicaMachine {
  const raw = unwrapRecord(data, ["machine"]) ?? {}
  return {
    userCode: userCode(raw),
    machineNo: machineNo(raw),
    name: rawString(raw.name, raw.machineName, raw.title),
    address: rawString(raw.address, raw.addr, raw.locationName),
    lat: rawNumber(raw.lat, raw.la, raw.latitude),
    lng: rawNumber(raw.lng, raw.lo, raw.lon, raw.longitude),
    distance: rawNumber(raw.distance, raw.distanceMeters),
    battery: rawNumber(raw.battery, raw.socPercent, raw.electricity, raw.power, raw.soc),
    status: rawString(raw.status, raw.machineStatus, raw.state),
    raw,
  }
}

export function toPerlicaMachineList(data: unknown): PerlicaMachine[] {
  return listRecords(data).map(toPerlicaMachine)
}

export function toPerlicaOrder(data: unknown): PerlicaOrder {
  const raw = unwrapRecord(data, ["order", "orderInfo", "borrowing"]) ?? {}
  return {
    orderNo: orderNo(raw),
    userCode: userCode(raw),
    machineNo: machineNo(raw),
    startTime: rawString(
      raw.startTime,
      raw.orderStartTime,
      raw.borrowTime,
      raw.beginTime,
      raw.createTime
    ),
    endTime: rawString(raw.endTime, raw.orderEndTime, raw.returnTime, raw.finishTime),
    status: rawString(raw.status, raw.orderStatus, raw.state),
    fee: rawNumber(raw.fee, raw.totalFee, raw.totalAmount, raw.amount),
    raw,
  }
}

function hasValue(record: PerlicaRaw): boolean {
  return Object.values(record).some((value) => {
    if (value === null || value === undefined || value === "") return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.keys(value).length > 0
    return true
  })
}

export function toPerlicaCurrentOrder(data: unknown): PerlicaOrder | null {
  const items = listRecords(data)
  if (items.length > 0) return toPerlicaCurrentOrder(items[0])
  const raw = unwrapRecord(data, ["order", "orderInfo", "borrowing"])
  if (!raw || !hasValue(raw)) return null
  return toPerlicaOrder(raw)
}

export function toPerlicaRideLog(data: unknown): PerlicaRideLog {
  const order = toPerlicaOrder(data)
  const explicitDuration = rawOptionalNumber(
    order.raw.duration,
    order.raw.rideDuration,
    order.raw.rideTime,
    order.raw.useTime
  )
  const cents = rawOptionalNumber(order.raw.actualPayMoney, order.raw.money)
  const payStatus = rawOptionalNumber(order.raw.payStatus)
  const status =
    order.status || (payStatus === 1 ? "paid" : payStatus === 0 ? "unpaid" : order.status)
  return {
    ...order,
    status,
    fee: cents === null ? order.fee : cents / 100,
    duration: explicitDuration ?? durationBetween(order.startTime, order.endTime) ?? 0,
    distance: rawNumber(order.raw.distance, order.raw.rideDistance, order.raw.mileage),
  }
}

export function toPerlicaRideLogs(data: unknown): PerlicaRideLog[] {
  return listRecords(data).map((value) => {
    const log = toPerlicaRideLog(value)
    const kilometers = rawOptionalNumber(log.raw.mileage)
    // queryPage returns kilometers; rideLogDetails returns the same field in meters.
    return kilometers === null ? log : { ...log, distance: kilometers * 1000 }
  })
}

const ONLINE_HEARTBEAT_MS = 10 * 60 * 1000
const ALLOWED_CLOCK_SKEW_MS = 5 * 60 * 1000

export function toPerlicaMachineStatus(data: unknown): PerlicaMachineStatus {
  const raw = unwrapRecord(data, ["machineStatus", "machine"]) ?? {}
  const status = rawString(raw.status, raw.machineStatus, raw.state)
  const explicitOnline = rawOptionalBoolean(raw.online, raw.isOnline)
  const statusOnline =
    status.toLowerCase() === "online" ? true : status.toLowerCase() === "offline" ? false : null
  const heartbeat = serviceTimestamp(
    rawString(raw.batDt, raw.heartbeatTime, raw.lastHeartbeat, raw.posDt)
  )
  const heartbeatAge = heartbeat === null ? null : Date.now() - heartbeat
  const heartbeatOnline =
    heartbeatAge === null
      ? null
      : heartbeatAge >= -ALLOWED_CLOCK_SKEW_MS && heartbeatAge <= ONLINE_HEARTBEAT_MS
  const rawMachineNo = machineNo(raw)
  const rawUserCode = userCode(raw) || (rawMachineNo.length === 8 ? rawMachineNo : "")
  return {
    userCode: rawUserCode,
    machineNo: rawMachineNo.length === 9 ? rawMachineNo : "",
    status,
    battery: rawNumber(raw.battery, raw.socPercent, raw.electricity, raw.power, raw.soc),
    online: explicitOnline ?? statusOnline ?? heartbeatOnline ?? false,
    lat: rawNumber(raw.lat, raw.la, raw.latitude),
    lng: rawNumber(raw.lng, raw.lo, raw.lon, raw.longitude),
    raw,
  }
}

export function toPerlicaMachineFee(data: unknown): PerlicaMachineFee {
  const raw = unwrapRecord(data, ["accountFee", "feeInfo"]) ?? {}
  const baseFee = rawOptionalNumber(raw.baseTimeFee)
  return {
    machineNo: machineNo(raw),
    fee: baseFee === null ? rawNumber(raw.fee, raw.totalFee, raw.amount, raw.price) : baseFee / 100,
    price: baseFee === null ? rawNumber(raw.price, raw.unitPrice, raw.fee) : baseFee / 100,
    unit: rawString(raw.unit, raw.timeUnit, raw.feeUnit),
    description: rawString(raw.description, raw.desc, raw.feeDesc, raw.remark),
    raw,
  }
}

function toCheck(data: unknown, wrappers: string[]): PerlicaReturnCheck {
  const raw = unwrapRecord(data, wrappers) ?? {}
  const explicit = [raw.allowed, raw.canReturn, raw.allowReturn, raw.pass, raw.supported]
  const hasExplicit = explicit.some((value) => value !== null && value !== undefined)
  return {
    allowed: hasExplicit ? rawBoolean(...explicit) : true,
    dispatchType: rawNumber(raw.dispatchType, raw.dispatch_type),
    message: rawString(raw.message, raw.msg, raw.description),
    raw,
  }
}

export function toPerlicaReturnCheck(data: unknown): PerlicaReturnCheck {
  return toCheck(data, ["returnCheck", "result"])
}

export function toPerlicaDispatchCheck(data: unknown): PerlicaDispatchCheck {
  const check = toCheck(data, ["dispatchCheck", "result"])
  const rawOptions = check.raw.types
  const options = Array.isArray(rawOptions)
    ? rawOptions.map((value) => {
        const raw = asRecord(value) ?? {}
        return { type: rawNumber(raw.type), money: rawNumber(raw.money) / 100 }
      })
    : []
  return {
    ...check,
    dispatchType: rawNumber(check.raw.dispatchType, check.raw.dispatch_type, check.raw.type),
    options,
  }
}

export function toPerlicaRideCard(data: unknown): PerlicaRideCard {
  const raw = unwrapRecord(data, ["rideCard", "card"]) ?? {}
  return {
    name: rawString(raw.name, raw.cardName),
    feeName: rawString(raw.feeName, raw.fee_name),
    startDate: rawString(raw.startDate, raw.startTime),
    dueTime: rawString(raw.dueTime, raw.dueDate, raw.endTime),
    remainingCount: rawNumber(raw.remainingCount, raw.remainCount),
    maxRide: rawNumber(raw.maxRide),
    useCount: rawNumber(raw.useCount),
    timeCount: rawNumber(raw.timeCount),
    currentNum: rawNumber(raw.currentNum),
    isValid: rawBoolean(raw.isValid, raw.valid, raw.is_valid),
    raw,
  }
}

export function toPerlicaRideCards(data: unknown): PerlicaRideCard[] {
  return listRecords(data)
    .map(toPerlicaRideCard)
    .filter((card) => card.isValid)
}

export function toPerlicaParkPoint(data: unknown): PerlicaParkPoint {
  const raw = unwrapRecord(data, ["parkPoint", "station", "point", "remand"]) ?? {}
  return {
    id: rawString(raw.id, raw.parkPointId, raw.stationId, raw.remandId),
    name: rawString(raw.name, raw.parkName, raw.pointName, raw.stationName, raw.title),
    address: rawString(raw.address, raw.addr, raw.locationName),
    lat: rawNumber(raw.lat, raw.la, raw.latitude, raw.y),
    lng: rawNumber(raw.lng, raw.lo, raw.lon, raw.longitude, raw.x),
    distance: rawNumber(raw.distance, raw.distanceMeters),
    area: coordinateList(raw.points),
    raw,
  }
}

export function toPerlicaParkPoints(data: unknown): PerlicaParkPoint[] {
  return listRecords(data).map(toPerlicaParkPoint)
}

export function toPerlicaStations(data: unknown): PerlicaStation[] {
  return listRecords(data).map((value) => {
    const point = toPerlicaParkPoint(value)
    return {
      ...point,
      accountId: rawString(point.raw.accountId, point.raw.accountID, point.raw.adAccountId),
    }
  })
}

export function toPerlicaRemandPoints(data: unknown): PerlicaRemandPoint[] {
  return listRecords(data).map(toPerlicaParkPoint)
}

export function toPerlicaGeoArea(data: unknown): PerlicaGeoArea {
  const raw = unwrapRecord(data, ["geoArea", "area", "geo"]) ?? {}
  const rawPoints = raw.pointList
  return {
    pointList: Array.isArray(rawPoints)
      ? rawPoints.map((value) => {
          const point = asRecord(value) ?? {}
          return { x: rawNumber(point.x), y: rawNumber(point.y) }
        })
      : [],
    centerLat: rawNumber(raw.centerLa, raw.centerLat),
    centerLng: rawNumber(raw.centerLo, raw.centerLng),
    finishOrderSwitch: rawBoolean(raw.finishOrderSwitch, raw.finish_order_switch),
    finishTime: rawNumber(raw.finishTime),
    stopTime: rawNumber(raw.stopTime),
    raw,
  }
}

export function toPerlicaRideRoute(data: unknown): PerlicaCoords[] {
  if (typeof data === "string") return coordinateList(data)
  return listRecords(data)
    .map((value) => {
      const raw = asRecord(value) ?? {}
      return {
        lat: rawNumber(raw.lat, raw.la, raw.latitude, raw.y),
        lng: rawNumber(raw.lng, raw.lo, raw.lon, raw.longitude, raw.x),
      }
    })
    .filter(
      (point) =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180 &&
        (point.lat !== 0 || point.lng !== 0)
    )
}

export function toPerlicaRideDetail(data: unknown): PerlicaRideDetail {
  const raw = unwrapRecord(data, ["rideDetail", "detail", "order"]) ?? {}
  const log = toPerlicaRideLog(raw)
  const borrowPoint = lonLat(raw.borrowLonLat)
  const returnPoint = lonLat(raw.returnLonLat)
  return {
    ...log,
    startAddress: rawString(raw.startAddress, raw.startAddr, raw.borrowAddress, raw.startLocation),
    endAddress: rawString(raw.endAddress, raw.endAddr, raw.returnAddress, raw.endLocation),
    startLat: borrowPoint?.lat ?? rawNumber(raw.startLat, raw.startLa, raw.borrowLat, raw.borrowLa),
    startLng:
      borrowPoint?.lng ??
      rawNumber(raw.startLng, raw.startLo, raw.startLon, raw.borrowLng, raw.borrowLon),
    endLat: returnPoint?.lat ?? rawNumber(raw.endLat, raw.endLa, raw.returnLat, raw.returnLa),
    endLng:
      returnPoint?.lng ??
      rawNumber(raw.endLng, raw.endLo, raw.endLon, raw.returnLng, raw.returnLon),
    route: toPerlicaRideRoute(raw.route ?? raw.track ?? raw.path),
  }
}

export function toPerlicaUnreadCount(data: unknown): number {
  const raw = unwrapRecord(data)
  return raw
    ? rawNumber(raw.count, raw.unreadCount, raw.notRead, raw.notReadCount, raw.num)
    : rawNumber(data)
}
