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
  /** Eight-digit code required by status, fee, and riding operations. */
  userCode: string
  /** Nine-digit number printed on the vehicle and used by the ring command. */
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
    startTime: rawString(raw.startTime, raw.borrowTime, raw.beginTime, raw.createTime),
    endTime: rawString(raw.endTime, raw.returnTime, raw.finishTime),
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
  return {
    ...order,
    duration: rawNumber(
      order.raw.duration,
      order.raw.rideDuration,
      order.raw.rideTime,
      order.raw.useTime
    ),
    distance: rawNumber(order.raw.distance, order.raw.rideDistance, order.raw.mileage),
  }
}

export function toPerlicaRideLogs(data: unknown): PerlicaRideLog[] {
  return listRecords(data).map(toPerlicaRideLog)
}

export function toPerlicaMachineStatus(data: unknown): PerlicaMachineStatus {
  const raw = unwrapRecord(data, ["machineStatus", "machine"]) ?? {}
  const status = rawString(raw.status, raw.machineStatus, raw.state)
  return {
    machineNo: machineNo(raw),
    status,
    battery: rawNumber(raw.battery, raw.socPercent, raw.electricity, raw.power, raw.soc),
    online: rawBoolean(raw.online, raw.isOnline) || status.toLowerCase() === "online",
    lat: rawNumber(raw.lat, raw.la, raw.latitude),
    lng: rawNumber(raw.lng, raw.lo, raw.lon, raw.longitude),
    raw,
  }
}

export function toPerlicaMachineFee(data: unknown): PerlicaMachineFee {
  const raw = unwrapRecord(data, ["accountFee", "feeInfo"]) ?? {}
  return {
    machineNo: machineNo(raw),
    fee: rawNumber(raw.fee, raw.totalFee, raw.amount, raw.price),
    price: rawNumber(raw.price, raw.unitPrice, raw.fee),
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
        return { type: rawNumber(raw.type), money: rawNumber(raw.money) }
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

export function toPerlicaRideDetail(data: unknown): PerlicaRideDetail {
  const raw = unwrapRecord(data, ["rideDetail", "detail", "order"]) ?? {}
  const log = toPerlicaRideLog(raw)
  return {
    ...log,
    startAddress: rawString(raw.startAddress, raw.startAddr, raw.borrowAddress, raw.startLocation),
    endAddress: rawString(raw.endAddress, raw.endAddr, raw.returnAddress, raw.endLocation),
    startLat: rawNumber(raw.startLat, raw.startLa, raw.borrowLat, raw.borrowLa),
    startLng: rawNumber(raw.startLng, raw.startLo, raw.startLon, raw.borrowLng, raw.borrowLon),
    endLat: rawNumber(raw.endLat, raw.endLa, raw.returnLat, raw.returnLa),
    endLng: rawNumber(raw.endLng, raw.endLo, raw.endLon, raw.returnLng, raw.returnLon),
  }
}

export function toPerlicaUnreadCount(data: unknown): number {
  const raw = unwrapRecord(data)
  return raw
    ? rawNumber(raw.count, raw.unreadCount, raw.notRead, raw.notReadCount, raw.num)
    : rawNumber(data)
}
