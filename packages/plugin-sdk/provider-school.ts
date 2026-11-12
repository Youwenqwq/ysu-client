export interface SchoolConfig {
  readonly id: string
  readonly name: string
  readonly nameEn: string
  readonly cas: {
    readonly cerBaseUrl: string
    readonly aesChars: string
    readonly mfaMethodToCode: Readonly<Record<string, string>>
    readonly mfaMethodToAuthCodeType: Readonly<Record<string, string>>
  }
  readonly jwxt: {
    readonly jwxtBaseUrl: string
    readonly portalPath: string
    readonly appShowPath: string
    readonly appIds: Readonly<Record<string, string>>
    readonly apiPaths: Readonly<Record<string, string>>
    /** Workaround: some backends return 404 for pjapp; retry with this route. */
    readonly pjappGoodRoute?: string
  }
  readonly ldxt?: {
    readonly baseUrl: string
  }
  readonly scxt?: {
    readonly baseUrl: string
    readonly ptBaseUrl: string
  }
  readonly xgxt?: {
    readonly baseUrl: string
  }
  readonly features: {
    readonly hasMobile: boolean
    readonly hasLabSchedule: boolean
    readonly hasMfa: boolean
  }
  /** false = 不在登录页显示，适配未完成 */
  readonly visible: boolean
}
